import { SetMetadata } from '@nestjs/common';
import { Role } from '../constants';

export const ROLES_KEY = 'roles';

/** Restricts a route to the roles in the v1.1 Endpoints table. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
