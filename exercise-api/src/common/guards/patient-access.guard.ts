import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { NotFoundException } from '../api.exception';
import { ROLES } from '../constants';
import { AuthUser, UsersService } from '../../users/users.service';

/**
 * Same rule as Health Monitoring: on /patients/:patientId routes, any doctor
 * reaches any active patient (team decision, Nov 2026: every doctor sees
 * every patient). Deactivated and non-existent patients give 404 NOT_FOUND.
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

    if (!(await this.users.isActivePatient(patientId))) throw new NotFoundException('Patient not found');
    return true;
  }
}
