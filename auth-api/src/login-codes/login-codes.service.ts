import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES, LOGIN_CODE, ROLES, Role } from '../common/constants';
import {
  InvalidLoginCodeException,
  UserInactiveException,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { toLocalIso } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { IDENTITY_PROVIDER, IdentityProvider } from '../identity/identity-provider';
import { UsersService } from '../users/users.service';
import { LoginCode } from './login-code.schema';

type Actor = { id: string; role: Role };

export interface LoginCodeRequestResponse {
  patient: { id: string; name: string; phone: string | null };
  requestedAt: string | null;
}

export interface IssuedLoginCodeResponse {
  patientId: string;
  phone: string;
  /** Shown once, to the doctor, to pass on to the patient. Never stored. */
  code: string;
  expiresAt: string | null;
  expiresInMinutes: number;
  maxAttempts: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Doctor-issued login codes (client change request, Nov 2026). Instead of an
 * SMS, the one-time code goes to the patient's doctor, who passes it on:
 *
 *   1. The patient enters their phone number and asks for a code (optional:
 *      the doctor can also make one without being asked).
 *   2. A linked doctor (or an admin) makes a code and tells the patient.
 *   3. The patient enters number + code; if right, this API makes a Firebase
 *      custom token and the app signs in with it.
 *
 * A code works once, for LOGIN_CODE_TTL_MINUTES, for LOGIN_CODE_MAX_ATTEMPTS
 * tries. The code is never stored or logged, only its hash.
 */
@Injectable()
export class LoginCodesService {
  readonly ttlMinutes: number;
  readonly maxAttempts: number;

  constructor(
    @InjectModel(LoginCode.name) private readonly model: Model<LoginCode>,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
    config: ConfigService,
  ) {
    this.ttlMinutes = setting(config.get('LOGIN_CODE_TTL_MINUTES'), LOGIN_CODE.DEFAULT_TTL_MINUTES, 1, 60);
    this.maxAttempts = setting(config.get('LOGIN_CODE_MAX_ATTEMPTS'), LOGIN_CODE.DEFAULT_MAX_ATTEMPTS, 1, 10);
  }

  /**
   * POST /auth/login-code/request. The answer is the same whether or not the
   * number belongs to a patient, so the route can't be used to look people up.
   */
  async request(phone: string): Promise<void> {
    const patient = await this.users.findActivePatientByPhone(phone);
    if (!patient) return;

    const now = new Date();
    const existing = await this.model.findOne({ patientId: patient._id }, { requestedAt: 1 }).lean();
    if (existing?.requestedAt && now.getTime() - existing.requestedAt.getTime() < LOGIN_CODE.REQUEST_REPEAT_SECONDS * 1000) {
      return; // Pressed again straight away: already on the doctor's list.
    }

    try {
      await this.model.updateOne(
        { patientId: patient._id },
        { $set: { requestedAt: now, deleteAt: new Date(now.getTime() + LOGIN_CODE.REQUEST_VISIBLE_HOURS * HOUR_MS) } },
        { upsert: true },
      );
    } catch (error) {
      // Two first requests at once: the other one made the row, which is all we need.
      if ((error as { code?: number }).code !== 11000) throw error;
    }

    await this.audit.record({
      actor: { id: String(patient._id), role: ROLES.PATIENT },
      action: AUDIT_ACTIONS.LOGIN_CODE_REQUESTED,
      patientId: patient._id,
      resourceId: String(patient._id),
    });
  }

  /** GET /doctor/login-code-requests: open requests from the caller's patients (any patient for an admin). */
  async openRequests(caller: Actor): Promise<{ data: LoginCodeRequestResponse[] }> {
    const since = new Date(Date.now() - LOGIN_CODE.REQUEST_VISIBLE_HOURS * HOUR_MS);
    const filter: FilterQuery<LoginCode> = { requestedAt: { $gte: since } };

    if (caller.role === ROLES.DOCTOR) {
      const linked = await this.users.model
        .find({ role: ROLES.PATIENT, active: true, doctorIds: new Types.ObjectId(caller.id) }, { _id: 1 })
        .lean();
      if (!linked.length) return { data: [] };
      filter.patientId = { $in: linked.map((p) => p._id) };
    }

    const rows = await this.model.find(filter).sort({ requestedAt: -1 }).limit(100).lean();
    const patients = await this.users.model
      .find({ _id: { $in: rows.map((r) => r.patientId) }, role: ROLES.PATIENT, active: true }, { name: 1, phone: 1, timeZone: 1 })
      .lean();
    const byId = new Map(patients.map((p) => [String(p._id), p]));

    return {
      data: rows
        .filter((row) => byId.has(String(row.patientId)))
        .map((row) => {
          const patient = byId.get(String(row.patientId))!;
          return {
            patient: { id: String(patient._id), name: patient.name, phone: patient.phone ?? null },
            requestedAt: toLocalIso(row.requestedAt, patient.timeZone),
          };
        }),
    };
  }

  /**
   * POST /patients/:patientId/login-code. A linked doctor or an admin makes a
   * new code; any earlier code stops working and the open request is closed.
   */
  async issue(caller: Actor, patientId: string): Promise<IssuedLoginCodeResponse> {
    const patient = await this.users.getPatientFor(caller, patientId);
    if (!patient.active) throw new UserInactiveException();
    if (!patient.phone) {
      throw new ValidationFailedException([
        { field: 'phone', code: DETAIL_CODES.REQUIRED, issue: "add the patient's phone number first: it is how they sign in" },
      ]);
    }

    const code = String(randomInt(0, 10 ** LOGIN_CODE.DIGITS)).padStart(LOGIN_CODE.DIGITS, '0');
    const expiresAt = new Date(Date.now() + this.ttlMinutes * MINUTE_MS);

    await this.tx.run(async (session) => {
      await this.model.updateOne(
        { patientId: patient._id },
        {
          $set: {
            codeHash: hashOf(String(patient._id), code),
            codeExpiresAt: expiresAt,
            attempts: 0,
            issuedBy: { id: new Types.ObjectId(caller.id), role: caller.role },
            requestedAt: null,
            deleteAt: expiresAt,
          },
        },
        { upsert: true, session },
      );
      await this.audit.record(
        {
          actor: caller,
          action: AUDIT_ACTIONS.LOGIN_CODE_ISSUED,
          patientId: patient._id,
          resourceId: String(patient._id),
          after: { expiresAt: expiresAt.toISOString() },
        },
        session,
      );
    });

    return {
      patientId: String(patient._id),
      phone: patient.phone,
      code,
      expiresAt: toLocalIso(expiresAt, patient.timeZone),
      expiresInMinutes: this.ttlMinutes,
      maxAttempts: this.maxAttempts,
    };
  }

  /**
   * POST /auth/login-code/verify. Every failure - unknown number, no code,
   * expired, wrong, used up - is the same 401, so nothing is given away.
   */
  async verify(phone: string, code: string): Promise<{ customToken: string }> {
    const patient = await this.users.findActivePatientByPhone(phone);
    if (!patient) throw new InvalidLoginCodeException();

    // Count the try first, atomically, so parallel guesses can't get more
    // than maxAttempts between them.
    const row = await this.model
      .findOneAndUpdate(
        {
          patientId: patient._id,
          codeHash: { $ne: null },
          codeExpiresAt: { $gt: new Date() },
          attempts: { $lt: this.maxAttempts },
        },
        { $inc: { attempts: 1 } },
        { new: true },
      )
      .lean();
    if (!row?.codeHash) throw new InvalidLoginCodeException();

    if (!sameHash(row.codeHash, hashOf(String(patient._id), code))) {
      if (row.attempts >= this.maxAttempts) {
        // Used up: the doctor has to make a new one.
        await this.model.updateOne({ _id: row._id, codeHash: row.codeHash }, { $set: { codeHash: null, codeExpiresAt: null } });
      }
      throw new InvalidLoginCodeException();
    }

    // Single use: only one of two parallel correct tries can delete it.
    const { deletedCount } = await this.model.deleteOne({ _id: row._id, codeHash: row.codeHash });
    if (!deletedCount) throw new InvalidLoginCodeException();

    await this.audit.record({
      actor: { id: String(patient._id), role: ROLES.PATIENT },
      action: AUDIT_ACTIONS.LOGIN_CODE_USED,
      patientId: patient._id,
      resourceId: String(patient._id),
    });

    return { customToken: await this.identity.createCustomToken(patient.firebaseUid) };
  }
}

function hashOf(patientId: string, code: string): string {
  return createHash('sha256').update(`${patientId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A whole number from the environment, else the default; out-of-range values fall back too. */
function setting(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
