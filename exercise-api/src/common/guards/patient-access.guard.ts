import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { NotFoundException } from '../api.exception';
import { ROLES } from '../constants';
import { AuthUser, UsersService } from '../../users/users.service';

/**
 * Same rule as Health Monitoring: on /patients/:patientId routes, a doctor
 * reaches only patients linked to them. Unlinked, deactivated and
 * non-existent patients all give the same 404 NOT_FOUND, so a doctor can't
 * tell whether a patient exists.
 */
@Injectable()
export class PatientAccessGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    const patientId = req.params?.patientId as string | undefined;
    if (!user || !patientId) return true;

    // The role guard has already limited these routes to DOCTOR.
    if (user.role !== ROLES.DOCTOR) throw new NotFoundException('Patient not found');

    const linked = await this.users.isPatientLinkedToDoctor(patientId, user.id);
    if (!linked) throw new NotFoundException('Patient not found');
    return true;
  }
}
