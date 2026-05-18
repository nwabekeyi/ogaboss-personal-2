import {
  Post,
  Patch,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { InternalUserService } from './internal-user.service';
import {
  CreateInternalUserDto,
  UpdateInternalUserDto,
  GetInternalUsersDto,
} from '../dto';
import { AdminRolesGuard, AuthGuard } from '../../../common';
import { AuthenticatedRequest } from '../../../common/types';
import { SuperAdmin, VersionedController } from '../../../core/decorators';
import { apiTags } from '../../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Admin - Internal Users')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.internalUser)
@SuperAdmin()
@UseGuards(AuthGuard, AdminRolesGuard)
export class InternalUsersController {
  constructor(private readonly internalUserService: InternalUserService) {}

  @Get()
  @ApiOperation({ summary: '[SUPER_ADMIN] Get all internal users' })
  @ApiResponse({
    status: 200,
    description: 'Internal users retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'adm_001',
            fullName: 'Jane Admin',
            gender: 'FEMALE',
            email: 'jane.admin@example.com',
            phoneNumber: '+2348012345678',
            role: 'ADMIN',
            accountStatus: 'ACTIVE',
            internalRole: {
              id: 'role_001',
              title: 'Support',
              permissions: ['VIEW_USERS', 'EDIT_USERS'],
            },
            createdAt: '2024-11-01T10:00:00.000Z',
            effectiveInternalRole: 'Support',
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      },
    },
  })
  async getAllInternalUsers(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetInternalUsersDto,
  ) {
    return this.internalUserService.getAllInternalUsers(req.user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '[SUPER_ADMIN] Get a specific internal user by ID' })
  @ApiParam({ name: 'id', description: 'Admin ID' })
  @ApiResponse({
    status: 200,
    description: 'Internal user retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'adm_001',
          fullName: 'Jane Admin',
          email: 'jane.admin@example.com',
          phoneNumber: '+2348012345678',
          role: 'ADMIN',
          residentialAddress: 'Ikeja, Lagos',
          gender: 'FEMALE',
          country: 'Nigeria',
          internalRole: {
            id: 'role_001',
            title: 'Support',
            permissions: ['VIEW_USERS', 'EDIT_USERS'],
          },
          createdAt: '2024-11-01T10:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Admin not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Admin not found',
        error: 'Not Found',
      },
    },
  })
  async getInternalUserById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.internalUserService.getInternalUserById(req.user.id, id);
  }

  @Post()
  @AuditLog({
    action: AuditAction.SUPER_ADMIN_CREATE_INTERNAL_USER,
    resource: AuditResource.ADMIN_INTERNAL_USER,
    resourceIdPath: 'body.email',
  })
  @ApiOperation({ summary: '[SUPER_ADMIN] Create new internal user (admin)' })
  @ApiBody({ type: CreateInternalUserDto })
  @ApiResponse({
    status: 201,
    description: 'Internal user created successfully',
  })
  async createInternalUser(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateInternalUserDto,
  ) {
    return this.internalUserService.createInternalUser(req.user.id, dto);
  }

  @Patch(':id')
  @AuditLog({
    action: AuditAction.SUPER_ADMIN_UPDATE_INTERNAL_USER,
    resource: AuditResource.ADMIN_INTERNAL_USER,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({
    summary: '[SUPER_ADMIN] Update internal user profile and role',
  })
  @ApiParam({ name: 'id', description: 'Admin ID' })
  @ApiBody({ type: UpdateInternalUserDto })
  async updateInternalUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateInternalUserDto,
  ) {
    return this.internalUserService.updateInternalUser(req.user.id, id, dto);
  }

  @Patch(':id/revoke-access')
  @AuditLog({
    action: AuditAction.SUPER_ADMIN_REVOKE_INTERNAL_ACCESS,
    resource: AuditResource.ADMIN_INTERNAL_USER,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({
    summary: '[SUPER_ADMIN] Revoke all internal access (remove role)',
  })
  @ApiParam({ name: 'id', description: 'Admin ID' })
  async revokeAllInternalAccess(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.internalUserService.revokeAllInternalAccess(req.user.id, id);
  }
}
