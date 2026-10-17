import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { DETAIL_CODES } from '../common/constants';
import {
  IdempotencyKeyInUseException,
  IdempotencyKeyReusedException,
  ValidationFailedException,
} from '../common/api.exception';
import { IdempotencyKey } from './idempotency-key.schema';

/** Visible ASCII, 1-255 characters: room for a UUID or any app-generated id. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/** A request still "in progress" after this long was abandoned (the server died mid-save). */
const ABANDONED_AFTER_MS = 60 * 1000;

/**
 * Optional Idempotency-Key for PUT /me/vitals/today.
 *
 * The app sends one unique key per save attempt and the same key on every
 * retry of it. The first request does the save and its answer is stored; a
 * retry gets that answer back and saves nothing, even if the log changed in
 * between. Without a key the save is still safe to repeat (unchanged values
 * are dropped); the key adds "this exact request, once".
 */
@Injectable()
export class IdempotencyService implements OnModuleInit {
  constructor(@InjectModel(IdempotencyKey.name) private readonly model: Model<IdempotencyKey>) {}

  /** The unique index is what stops two requests with one key both saving; wait for it. */
  async onModuleInit(): Promise<void> {
    await this.model.init();
  }

  async run<T extends object>(
    patientId: string,
    key: string | undefined,
    body: unknown,
    save: () => Promise<T>,
  ): Promise<T> {
    if (key === undefined) return save();
    if (!KEY_PATTERN.test(key)) {
      throw new ValidationFailedException([
        { field: 'Idempotency-Key', code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be 1-255 visible ASCII characters' },
      ]);
    }

    const filter = { patientId: new Types.ObjectId(patientId), key };
    const requestHash = hashOf(body);
    const stored = await this.claim(filter, requestHash);
    if (stored) return stored as T;

    let response: T;
    try {
      response = await save();
    } catch (error) {
      // A failed request leaves nothing saved, so it doesn't use up the key:
      // the app can fix the body and send it again with the same key.
      await this.model.deleteOne({ ...filter, response: null }).exec();
      throw error;
    }

    const plain = JSON.parse(JSON.stringify(response)) as Record<string, unknown>;
    await this.model.updateOne(filter, { $set: { response: plain } }).exec();
    return response;
  }

  /**
   * Takes the key for this request. Returns the stored answer when an earlier
   * request with the same key and body already finished, or null when this
   * request should go ahead and save.
   */
  private async claim(
    filter: { patientId: Types.ObjectId; key: string },
    requestHash: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      await this.model.create({ ...filter, requestHash, claimedAt: new Date() });
      return null;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }

    const existing = await this.model.findOne(filter).lean();
    // Deleted by a failing request in the meantime: a retry will find it free.
    if (!existing) throw new IdempotencyKeyInUseException();
    if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedException();
    if (existing.response) return existing.response;

    // Still running. Take it over only if it was abandoned, and only once.
    const takenOver = await this.model
      .updateOne(
        { ...filter, response: null, claimedAt: { $lt: new Date(Date.now() - ABANDONED_AFTER_MS) } },
        { $set: { claimedAt: new Date() } },
      )
      .exec();
    if (takenOver.modifiedCount) return null;
    throw new IdempotencyKeyInUseException();
  }
}

/** Same body, same hash - whatever order the client wrote the fields in. */
function hashOf(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
