import { SetMetadata } from '@nestjs/common';
import { Role } from '../constants';

export const ROLES_KEY = 'roles';

/** Restricts a route to the roles in the reference's endpoint tables. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
