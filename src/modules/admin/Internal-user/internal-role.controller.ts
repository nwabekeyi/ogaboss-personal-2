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
import { CreateRoleDto, GetRolesDto, UpdateRoleDto } from '../dto';
import { AdminRolesGuard, AuthGuard } from '../../../common';
import { AuthenticatedRequest } from '../../../common/types';
import { SuperAdmin, VersionedController } from '../../../core/decorators';
import { apiTags } from '../../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Admin - Internal Roles')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.internalRole)
@SuperAdmin()
@UseGuards(AuthGuard, AdminRolesGuard)
export class InternalRolesController {
  constructor(private readonly internalUserService: InternalUserService) {}

  @Get()
  @ApiOperation({ summary: '[SUPER_ADMIN] Get all internal roles' })
  @ApiResponse({
    status: 200,
    description: 'Roles retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'role_001',
            title: 'Support',
            isActive: true,
            assignedUsersCount: 3,
            permissions: [
              {
                id: 'perm_001',
                key: 'VIEW_USERS',
                name: 'View Users',
                description: 'Can view user accounts',
              },
              {
                id: 'perm_003',
                key: 'RESPOND_TICKETS',
                name: 'Respond to Tickets',
                description: 'Can respond to support tickets',
              },
            ],
          },
          {
            id: 'role_002',
            title: 'Finance',
            isActive: false,
            assignedUsersCount: 0,
            permissions: [
              {
                id: 'perm_001',
                key: 'VIEW_USERS',
                name: 'View Users',
                description: 'Can view user accounts',
              },
              {
                id: 'perm_003',
                key: 'RESPOND_TICKETS',
                name: 'Respond to Tickets',
                description: 'Can respond to support tickets',
              },
            ],
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      },
    },
  })
  async getAllRoles(@Query() query: GetRolesDto) {
    return this.internalUserService.getAllRoles(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '[SUPER_ADMIN] Get a specific internal role by ID' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({
    status: 200,
    description: 'Role retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'role_001',
          title: 'Support',
          description: 'Customer support role',
          isActive: true,
          permissions: [
            {
              id: 'perm_001',
              key: 'VIEW_USERS',
              name: 'View Users',
              description: 'Can view user accounts',
            },
            {
              id: 'perm_003',
              key: 'RESPOND_TICKETS',
              name: 'Respond to Tickets',
              description: 'Can respond to support tickets',
            },
          ],
          admins: [
            {
              id: 'adm_001',
              fullName: 'Jane Admin',
              email: 'jane.admin@example.com',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Role not found',
        error: 'Not Found',
      },
    },
  })
  async getInternalRoleById(
    @Req() req: AuthenticatedRequest,
    @Param('id') roleId: string,
  ) {
    return this.internalUserService.getInternalRoleById(req.user.id, roleId);
  }

  @Get('/permissions/all')
  @ApiOperation({
    summary: '[SUPER_ADMIN] Get all available system permissions',
  })
  @ApiResponse({
    status: 200,
    description: 'Permissions retrieved successfully',
    schema: {
      example: {
        success: true,
        message: 'Permissions retrieved successfully',
        data: [
          {
            id: 'perm_001',
            key: 'VIEW_USERS',
            name: 'View Users',
            description: 'Can view user accounts',
          },
          {
            id: 'perm_002',
            key: 'EDIT_USERS',
            name: 'Edit Users',
            description: 'Can edit user accounts',
          },
        ],
      },
    },
  })
  async getAllPermissions() {
    return this.internalUserService.getAllPermissions();
  }

  @Post()
  @AuditLog({
    action: AuditAction.SUPER_ADMIN_CREATE_INTERNAL_ROLE,
    resource: AuditResource.ADMIN_INTERNAL_ROLE,
  })
  @ApiOperation({ summary: '[SUPER_ADMIN] Create new internal role' })
  @ApiBody({ type: CreateRoleDto })
  async createRole(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateRoleDto,
  ) {
    return this.internalUserService.createRole(req.user.id, dto);
  }

  @Patch(':id')
  @AuditLog({
    action: AuditAction.SUPER_ADMIN_UPDATE_INTERNAL_ROLE,
    resource: AuditResource.ADMIN_INTERNAL_ROLE,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({
    summary: '[SUPER_ADMIN] Edit role title, description, or active status',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiBody({ type: UpdateRoleDto })
  async editRole(
    @Req() req: AuthenticatedRequest,
    @Param('id') roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.internalUserService.updateRole(req.user.id, roleId, dto);
  }

  @Delete(':id')
  @AuditLog({
    action: AuditAction.SUPER_ADMIN_DELETE_INTERNAL_ROLE,
    resource: AuditResource.ADMIN_INTERNAL_ROLE,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({ summary: '[SUPER_ADMIN] Delete an internal role' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  async deleteRole(
    @Req() req: AuthenticatedRequest,
    @Param('id') roleId: string,
  ) {
    return this.internalUserService.deleteRole(req.user.id, roleId);
  }
}
