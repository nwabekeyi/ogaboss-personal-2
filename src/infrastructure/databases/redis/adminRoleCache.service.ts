import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';

@Injectable()
export class AdminRoleCacheService implements OnModuleInit {
  private readonly logger = new Logger(AdminRoleCacheService.name);

  // Cache key prefix
  private readonly ADMIN_ROLE_KEY_PREFIX = 'admin:internalRoleId:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  // Called on module startup
  async onModuleInit() {
    await this.cacheAllAdminRoles();
    this.logger.log('Admin internalRoleId cache initialized and loaded');
  }

  // Generate cache key for admin
  private getAdminRoleKey(adminId: string): string {
    return `${this.ADMIN_ROLE_KEY_PREFIX}${adminId}`;
  }

  // Cache a single admin's internalRoleId
  async cacheAdminRole(adminId: string, internalRoleId: string | null) {
    if (!internalRoleId) return;
    const key = this.getAdminRoleKey(adminId);
    await this.redisService.set(key, internalRoleId);
  }

  // Get internalRoleId from cache (with DB fallback)
  async getAdminInternalRoleId(adminId: string): Promise<string> {
    const key = this.getAdminRoleKey(adminId);

    const cached = await this.redisService.get<string>(key);
    if (cached) return cached;

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { internalRoleId: true },
    });

    if (!admin || !admin.internalRoleId) {
      throw new Error(`Admin ${adminId} has no valid internalRoleId`);
    }

    await this.cacheAdminRole(adminId, admin.internalRoleId);
    return admin.internalRoleId;
  }

  // Load all admins into Redis on startup
  async cacheAllAdminRoles() {
    const admins = await this.prisma.admin.findMany({
      select: { id: true, internalRoleId: true },
    });

    if (!admins.length) {
      this.logger.warn('No admins found to cache');
      return;
    }

    const pipeline = this.redisService.getClient().pipeline();
    let skipped = 0;

    for (const admin of admins) {
      if (!admin.internalRoleId) {
        skipped++;
        this.logger.warn(`Admin ${admin.id} has no internalRoleId; skipping cache`);
        continue;
      }

      const key = this.getAdminRoleKey(admin.id);
      pipeline.set(key, admin.internalRoleId); // No TTL
    }

    await pipeline.exec();

    if (skipped > 0) {
      this.logger.warn(`${skipped} admin(s) skipped during role cache warm-up`);
    }
  }

  // When an admin is created
  async onAdminCreated(adminId: string, internalRoleId: string | null) {
    await this.cacheAdminRole(adminId, internalRoleId);
  }

  // When an admin's internalRoleId is updated
  async onAdminRoleUpdated(adminId: string, newInternalRoleId: string | null) {
    await this.cacheAdminRole(adminId, newInternalRoleId);
  }

  // When an admin is deleted
  async onAdminDeleted(adminId: string) {
    const key = this.getAdminRoleKey(adminId);
    await this.redisService.del(key);
  }

  // Optional: Full cache refresh (e.g., after bulk operations)
  async refreshCache() {
    await this.cacheAllAdminRoles();
  }
}
