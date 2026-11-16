import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { NotFoundException } from '../api.exception';
import { ROLES } from '../constants';
import { AuthUser, UsersService } from '../../users/users.service';

/**
 * Doctor endpoints on /doctor/patients/:patientId. Any doctor may reach any
 * active patient (team decision, Nov 2026: every doctor sees every patient);
 * deactivated and non-existent patients give 404 NOT_FOUND.
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

    if (!(await this.users.isActivePatient(patientId))) throw new NotFoundException('Patient not found');
    return true;
  }
}
