import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import {
  CreateInternalUserDto,
  CreateRoleDto,
  UpdateInternalUserDto,
  UpdateRoleDto,
} from '../dto';
import { AccountStatus, AdminRole} from '../../../infrastructure';
import { ErrorMessages, hash } from '../../../shared';
import { RolesCacheService } from '../../../infrastructure/databases/redis/roleCache.service';
import { AdminRoleCacheService } from '../../../infrastructure/databases/redis/adminRoleCache.service';

@Injectable()
export class InternalUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rolesCache: RolesCacheService,
    private readonly adminRoleCache: AdminRoleCacheService,
  ) {}

  private async requireSuperAdmin(adminId: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true },
    });

    if (!admin || admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZE);
    }

    return admin;
  }

// === ROLE MANAGEMENT ===
async createRole(superAdminId: string, dto: CreateRoleDto & { permissions?: string[] }) {
  await this.requireSuperAdmin(superAdminId);

  return await this.prisma.$transaction(async (tx) => {
    // 1. Check if role already exists
    const existingRole = await tx.role.findUnique({ where: { title: dto.title } });
    if (existingRole) throw new ConflictException(`Role "${dto.title}" already exists`);

    // 2. Validate permissions if provided
    let permissionsConnect: { id: string }[] = [];
    if (dto.permissions?.length) {
      const permissionRecords = await tx.permissions.findMany({
        where: { id: { in: dto.permissions } },
      });

      if (permissionRecords.length !== dto.permissions.length) {
        throw new BadRequestException('One or more permission IDs are invalid');
      }

      permissionsConnect = permissionRecords.map((p) => ({ id: p.id }));
    }

    // 3. Create role with permissions
    const role = await tx.role.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        isActive: true,
        permissions: {
          connect: permissionsConnect,
        },
      },
      include: { admins: { select: { id: true, fullName: true, email: true } }, permissions: true },
    });

    // 4. Update cache after successful transaction
    await this.rolesCache.refreshRoleCache(role.id);

    return {
      success: true,
      message: 'Role created successfully',
      data: role,
    };
  });
}

async updateRole(superAdminId: string, roleId: string, dto: UpdateRoleDto & { permissions?: string[] }) {
  await this.requireSuperAdmin(superAdminId);

  return await this.prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      include: { admins: true, permissions: true },
    });

    if (!role) throw new NotFoundException('Role not found');
    if (role.title === 'MASTER') throw new ForbiddenException(ErrorMessages.ACCESS_DENIED);

    const data: any = {};

    // 1. Title update
    if (dto.title !== undefined) {
      dto.title = dto.title.trim();
      if (dto.title !== role.title) {
        const existing = await tx.role.findUnique({ where: { title: dto.title } });
        if (existing) throw new ConflictException(`Role title "${dto.title}" already exists`);
        data.title = dto.title;
      }
    }

    // 2. Description update
    if (dto.description !== undefined) {
      data.description = dto.description.trim();
    }

    // 3. Activate/Deactivate
    if (dto.isActive !== undefined) {
      if (dto.isActive === false && role.admins.length > 0) {
        throw new BadRequestException('Cannot deactivate role assigned to admins');
      }
      data.isActive = dto.isActive;
    }

    // 4. Permissions update
    if (dto.permissions !== undefined) {
      // Validate permissions
      const permissionRecords = await tx.permissions.findMany({
        where: { id: { in: dto.permissions } },
      });

      if (permissionRecords.length !== dto.permissions.length) {
        throw new BadRequestException('One or more permission IDs are invalid');
      }

      data.permissions = {
        set: [], // disconnect all first
        connect: permissionRecords.map((p) => ({ id: p.id })),
      };
    }

    // 5. No changes?
    if (Object.keys(data).length === 0) {
      return {
        success: true,
        message: 'No changes made',
        data: role,
      };
    }

    // 6. Update role
    const updatedRole = await tx.role.update({
      where: { id: roleId },
      data,
      include: { admins: { select: { id: true, fullName: true, email: true } }, permissions: true },
    });

    // 7. Update cache after transaction
    await this.rolesCache.refreshRoleCache(roleId);

    return {
      success: true,
      message: 'Role updated successfully',
      data: updatedRole,
    };
  });
}


  async getAllRoles(
    query: {
      page?: number;
      limit?: number;
      isActive?: boolean;
      search?: string;
    } = {},
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    // First, get the roles with admin count
    const rolesWithCount = await this.prisma.role.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        isActive: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { admins: true },
        },
      },
      orderBy: { title: 'asc' },
      skip,
      take: limit,
    });

    // Get total count for pagination
    const total = await this.prisma.role.count({ where });

    const totalPages = Math.ceil(total / limit);

    const formattedRoles = rolesWithCount.map((role) => ({
      id: role.id,
      title: role.title,
      description: role.description,
      isActive: role.isActive,
      assignedUsersCount: role._count.admins,
      permissions: role.permissions.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
      })),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));

    return {
      success: true,
      data: formattedRoles,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getAllPermissions() {
    const permissions = await this.prisma.permissions.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      message: 'Permissions retrieved successfully',
      data: permissions,
    };
  }

  async getInternalRoleById(superAdminId: string, roleId: string) {
    await this.requireSuperAdmin(superAdminId);

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        admins: { select: { id: true, fullName: true, email: true } },
        permissions: {
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return {
      success: true,
      data: role,
    };
  }

  // NEW: Delete Role
  async deleteRole(superAdminId: string, roleId: string) {
    await this.requireSuperAdmin(superAdminId);

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { admins: true },
    });

    if (!role) throw new NotFoundException('Role not found');

    if (role.title === 'MASTER') {
      throw new ForbiddenException('Cannot delete the MASTER role');
    }

    if (role.admins.length > 0) {
      throw new BadRequestException('Cannot delete role assigned to admins');
    }

    await this.prisma.role.delete({
      where: { id: roleId },
    });

    // Update Redis cache (remove role)
    await this.rolesCache.refreshRoleCache(roleId);

    return {
      success: true,
      message: 'Role deleted successfully',
    };
  }

  // === INTERNAL USER (ADMIN) MANAGEMENT ===

  async createInternalUser(superAdminId: string, dto: CreateInternalUserDto) {
    await this.requireSuperAdmin(superAdminId);

    // Validate role if provided
    if (dto.internalRoleId) {
      const cachedRole = await this.rolesCache.getRoleById(dto.internalRoleId);
      if (!cachedRole) {
        throw new BadRequestException('Internal role does not exist');
      }

      if (!cachedRole.isActive) {
        throw new BadRequestException(`Role "${cachedRole.title}" is inactive and cannot be assigned`);
      }
      if (cachedRole.title === 'MASTER') {
        throw new ForbiddenException(`Role access denied`);
      }
    }

    const existing = await this.prisma.admin.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Email already in use');
    }

    const hashedPassword = await hash(dto.password);

    const [firstName, ...rest] = dto.fullName.trim().split(' ');
    const lastName = rest.join(' ') || 'User';

    const data: any = {
      firstName: firstName || 'Admin',
      lastName,
      fullName: dto.fullName.trim(),
      email: dto.email,
      password: hashedPassword,
      phoneNumber: dto.phoneNumber || null,
      gender: dto.gender || null,
      residentialAddress: dto.residentialAddress || null,
      country: dto.country || null,
      role: AdminRole.ADMIN,
      // Directly assign the role ID if provided
      internalRoleId: dto.internalRoleId || null,
    };

    const newAdmin = await this.prisma.admin.create({
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        internalRole: {
          select: { id: true, title: true, permissions: true },
        },
        createdAt: true,
      },
    });

    // Update admin → role mapping cache
    await this.adminRoleCache.onAdminCreated(newAdmin.id, dto.internalRoleId || null);

    return {
      success: true,
      message: 'Created successfully',
      data: newAdmin,
    };
  }

  async updateInternalUser(
    superAdminId: string,
    adminId: string,
    dto: UpdateInternalUserDto,
  ) {
    await this.requireSuperAdmin(superAdminId);

    const target = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!target) throw new NotFoundException('Admin not found');

    if (target.role === AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot modify Super Admin');
    }

    const data: any = {};

    // Profile fields
    if (dto.fullName !== undefined) {
      const [firstName, ...rest] = dto.fullName.trim().split(' ');
      const lastName = rest.join(' ') || 'User';
      data.firstName = firstName || 'Admin';
      data.lastName = lastName;
      data.fullName = dto.fullName.trim();
    }

    if (dto.email !== undefined) {
      if (dto.email !== target.email) {
        const existing = await this.prisma.admin.findUnique({
          where: { email: dto.email },
        });
        if (existing) throw new BadRequestException('Email already in use');
      }
      data.email = dto.email;
    }

    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber || null;
    if (dto.gender !== undefined) data.gender = dto.gender || null;
    if (dto.residentialAddress !== undefined) data.residentialAddress = dto.residentialAddress || null;
    if (dto.country !== undefined) data.country = dto.country || null;

    // Internal Role update
    if (dto.internalRoleId !== undefined) {
      if (dto.internalRoleId === null) {
        data.internalRoleId = null;
      } else {
        const cachedRole = await this.rolesCache.getRoleById(dto.internalRoleId);

        if (!cachedRole) {
          throw new BadRequestException(`Internal role with ID "${dto.internalRoleId}" does not exist`);
        }

        if (!cachedRole.isActive) {
          throw new BadRequestException(`Role "${cachedRole.title}" is inactive and cannot be assigned`);
        }
        if (cachedRole.title === 'MASTER') {
          throw new ForbiddenException(`Role access denied`);
        }

        data.internalRoleId = dto.internalRoleId; // Direct assignment after validation
      }
    }

    // Account status update
    if (dto.accountStatus !== undefined) {
      if (dto.accountStatus === target.accountStatus) {
        return {
          success: true,
          message: `Admin is already ${dto.accountStatus.toLowerCase()}`,
        };
      }
      data.accountStatus = dto.accountStatus;
    }

    if (Object.keys(data).length === 0) {
      return {
        success: true,
        message: 'No changes made',
        data: target,
      };
    }

    const updated = await this.prisma.admin.update({
      where: { id: adminId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        gender: true,
        residentialAddress: true,
        country: true,
        role: true,
        accountStatus: true,
        internalRole: {
          select: { id: true, title: true, permissions: true },
        },
        createdAt: true,
      },
    });

    // Update caches
    if (dto.accountStatus === AccountStatus.DEACTIVATED) {
      await this.adminRoleCache.onAdminRoleUpdated(adminId, null);
    }

    if (dto.internalRoleId !== undefined) {
      await this.adminRoleCache.onAdminRoleUpdated(adminId, dto.internalRoleId || null);
    }

    return {
      success: true,
      message: 'Internal user updated successfully',
      data: updated,
    };
  }

    async getAllInternalUsers(
      superAdminId: string,
      query: {
        page?: number;
        limit?: number;
        search?: string;
      } = {},
    ) {
      await this.requireSuperAdmin(superAdminId);

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const skip = (page - 1) * limit;

      const where: any = {};

      if (query.search) {
        const term = query.search.trim();
        where.OR = [
          { id: { contains: term, mode: 'insensitive' } },
          { fullName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ];
      }

      const [admins, total] = await Promise.all([
        this.prisma.admin.findMany({
          where,
          select: {
            id: true,
            fullName: true,
            gender: true,
            email: true,
            phoneNumber: true,
            role: true,
            accountStatus: true,
            internalRole: {
              select: { id: true, title: true, permissions: true },
            },
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.admin.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      const formatted = admins.map((admin) => ({
        ...admin,
        effectiveInternalRole: admin.role === AdminRole.SUPER_ADMIN
          ? 'MASTER'
          : (admin.internalRole?.title || 'None'),
      }));

      return {
        success: true,
        data: formatted,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    }

  async getInternalUserById(superAdminId: string, adminId: string) {
    await this.requireSuperAdmin(superAdminId);

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        residentialAddress: true,
        gender: true,
        country:true,
        internalRole: {
          select: { id: true, title: true, permissions: true },
        },
        createdAt: true,
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return {
      success: true,
      data: admin,
    };
  }

    //Revoke all internal access (remove internal role)
    async revokeAllInternalAccess(
      superAdminId: string,
      targetAdminId: string,
    ) {
      await this.requireSuperAdmin(superAdminId);

      const target = await this.prisma.admin.findUnique({
        where: { id: targetAdminId },
      });

      if (!target) throw new NotFoundException('Admin not found');

      if (target.role === AdminRole.SUPER_ADMIN) {
        throw new ForbiddenException('Cannot revoke access from Super Admin');
      }

      if (!target.internalRoleId) {
        return {
          success: true,
          message: 'Admin has no internal role to revoke',
        };
      }

      const updated = await this.prisma.admin.update({
        where: { id: targetAdminId },
        data: {
          internalRoleId: null,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          internalRole: true,
        },
      });

      // Update Redis cache — remove role mapping
      await this.adminRoleCache.onAdminRoleUpdated(targetAdminId, null);

      return {
        success: true,
        message: 'All internal access revoked successfully',
        data: updated,
      };
    }
}