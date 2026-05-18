import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../../common/types';
import { AdminRole, AccountStatus } from '../../infrastructure';
import { RolesCacheService } from '../../infrastructure/databases/redis/roleCache.service';
import { AdminRoleCacheService } from '../../infrastructure/databases/redis/adminRoleCache.service';
import { ErrorMessages } from '../../shared/constants';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolesCache: RolesCacheService,
    private readonly adminRoleCache: AdminRoleCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // Basic user validation
    if (!user || user.userType !== 'ADMIN') {
      throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZED);
    }

    // 1. Check if admin account is ACTIVE
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(ErrorMessages.ACCESS_DENIED);
    }

    // Super Admin required decorator
    const isSuperAdminRequired =
      this.reflector.get<boolean>('super_admin', context.getHandler()) ||
      this.reflector.get<boolean>('super_admin', context.getClass());

    if (isSuperAdminRequired && user.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZED);
    }

    // Super Admin bypass — full access, no further checks
    if (user.role === AdminRole.SUPER_ADMIN) {
      return true;
    }

    // 2. Verify internalRoleId integrity via Redis (role not revoked/changed)
    const cachedInternalRoleId = await this.adminRoleCache.getAdminInternalRoleId(user.id);

    if (user.internalRoleId && cachedInternalRoleId === null) {
      throw new ForbiddenException(ErrorMessages.ACCESS_DENIED);
    }

    if (!user.internalRoleId && cachedInternalRoleId !== null) {
      throw new ForbiddenException('Role assignment mismatch detected');
    }

    if (user.internalRoleId && cachedInternalRoleId !== user.internalRoleId) {
      throw new ForbiddenException(ErrorMessages.ROLE_CHANGED);
    }

    // If no internal role assigned → block if permissions are required
    const requiredPermissions =
      this.reflector.get<string[]>('permissions', context.getHandler()) ?? [];

      if (requiredPermissions.length === 0) {
      return true; // No permissions needed → allow active admin
    }

    if (!user.internalRoleId) {
      throw new ForbiddenException('No active role assigned');
    }

    // 3. Check if the assigned role itself is active
    const roleDetails = await this.rolesCache.getRoleById(user.internalRoleId);

    if (!roleDetails || !roleDetails.isActive) {
      throw new ForbiddenException('Inactive role');
    }

    // 4. Finally, check permissions
    const rolePermissions = roleDetails.permissions ?? [];

    if (!rolePermissions.length) {
      throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZED);
    }

    const permissions = roleDetails.permissions || [];

    if (!permissions.length) {
      throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZED);
    }

    const rolePermissionIds = new Set(
      rolePermissions.map(p => p.id),
    );

    const hasAllPermissions = requiredPermissions.every(
      permissionId => rolePermissionIds.has(permissionId),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZED);
    }

    return true;
  }
}