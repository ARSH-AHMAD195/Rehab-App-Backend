import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { NotFoundException } from '../api.exception';
import { ROLES } from '../constants';
import { AuthUser, UsersService } from '../../users/users.service';

/**
 * Doctor endpoints, v1.1: "PatientAccessGuard returns 404 when the patient
 * isn't linked to the calling doctor, so the doctor can't tell whether that
 * patient exists."
 *
 * Unlinked and non-existent patients therefore give the same 404 NOT_FOUND.
 */
@Injectable()
export class PatientAccessGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    const patientId = req.params?.patientId as string | undefined;
    if (!user || !patientId) return true;

    // Admins are not given patient data by these routes; the role guard has
    // already limited them to DOCTOR.
    if (user.role !== ROLES.DOCTOR) throw new NotFoundException('Patient not found');

    const linked = await this.users.isPatientLinkedToDoctor(patientId, user.id);
    if (!linked) throw new NotFoundException('Patient not found');
    return true;
  }
}
