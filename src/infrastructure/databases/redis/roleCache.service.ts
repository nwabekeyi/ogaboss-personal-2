// src/core/services/roles-cache.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';
import { Permissions } from '../prisma/generated/prisma/client';

interface CachedRole {
  id: string;
  title: string;
  permissions: Permissions[];
  isActive: boolean;
}

@Injectable()
export class RolesCacheService implements OnModuleInit {
  private readonly roleKeyPrefix = 'internalRole:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /* ================= INIT ================= */
  async onModuleInit() {
    await this.refreshAllRolesCache();
  }

  /* ================= CORE GETTER WITH FALLBACK ================= */
  private async getRoleWithFallback(roleId: string): Promise<CachedRole | null> {
    const redisKey = `${this.roleKeyPrefix}${roleId}`;

    // 1. Try cache first (safe get)
    const cached = await this.redisService.get<CachedRole>(redisKey);
    if (cached) return cached;

    // 2. Cache miss → fetch from DB
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });

    if (!role) return null;

    const cachedRole: CachedRole = {
      id: role.id,
      title: role.title,
      permissions: role.permissions,
      isActive: role.isActive,
    };

    // 3. Warm the cache (no TTL)
    await this.redisService.set(redisKey, cachedRole);

    return cachedRole;
  }

  /* ================= PUBLIC GETTERS ================= */

  /** Returns full role or null if not exists */
  async getRoleById(roleId: string): Promise<CachedRole | null> {
    return this.getRoleWithFallback(roleId);
  }

  /** Guards use this — now safe even on cache miss */
  async getPermissions(roleId: string): Promise<Permissions[]> {
    const role = await this.getRoleWithFallback(roleId);
    return role?.permissions ?? [];
  }

  async isRoleActive(roleId: string): Promise<boolean> {
    const role = await this.getRoleWithFallback(roleId);
    return role?.isActive ?? false;
  }

  /* ================= CACHE MUTATIONS ================= */

  async refreshRoleCache(roleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });

    const redisKey = `${this.roleKeyPrefix}${roleId}`;

    if (!role) {
      await this.redisService.del(redisKey);
      return;
    }

    const cachedRole: CachedRole = {
      id: role.id,
      title: role.title,
      permissions: role.permissions,
      isActive: role.isActive,
    };

    await this.redisService.set(redisKey, cachedRole);
  }

  async refreshAllRolesCache() {
    const roles = await this.prisma.role.findMany({
      include: { permissions: true },
    });

    for (const role of roles) {
      const redisKey = `${this.roleKeyPrefix}${role.id}`;
      const cachedRole: CachedRole = {
        id: role.id,
        title: role.title,
        permissions: role.permissions,
        isActive: role.isActive,
      };

      await this.redisService.set(redisKey, cachedRole);
    }
  }

  async deleteRoleCache(roleId: string) {
    const redisKey = `${this.roleKeyPrefix}${roleId}`;
    await this.redisService.del(redisKey);
  }
}
