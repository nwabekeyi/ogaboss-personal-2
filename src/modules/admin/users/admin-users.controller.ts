import { Get, Patch, Query, Param, Body, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiBearerAuth,
  ApiResponseProperty,
  ApiResponse,
} from '@nestjs/swagger';
import { AdminUserService } from './admin-users.service';
import {
  GetAdminUsersDto,
  FlagUserDto,
  GetTransactionHistoryDto,
} from '../dto';
import {
  RequirePermissions,
  VersionedController,
} from '../../../core/decorators';
import { apiTags } from '../../../shared';
import { AuthenticatedRequest } from '../../../common/types';
import { Permission } from '../../../infrastructure';
import { AdminRolesGuard, AuthGuard } from '../../../common';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Admin - Users')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.adminUsers)
@UseGuards(AuthGuard, AdminRolesGuard)
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get(':id/personal-detail')
  @RequirePermissions(Permission.USER_ACCOUNT_ACCESS)
  @ApiOperation({
    summary:
      '[ADMIN] Get full user personal info + wallet + transaction summary',
  })
  @ApiResponse({
    status: 200,
    description: 'Full user details with transaction summary',
    schema: {
      example: {
        success: true,
        data: {
          userId: 'usr_123abc',
          accountName: 'John Doe',
          email: 'john@example.com',
          phoneNumber: '+2348012345678',
          country: 'Nigeria',
          residentialAddress: 'Lagos, Nigeria',
          dateOfBirth: '1994-06-15',
          gender: 'MALE',
          joinedDate: '2025-11-20',
          status: 'ACTIVE',
          flaggedReason: null,
          walletAddress: 'QDX_98HF23',
          transactionSummary: {
            totalTransactions: '₦1,200,000.00',
            amountSent: '₦300,000.00',
            amountReceived: '₦500,000.00',
            amountBought: '₦250,000.00',
            amountSold: '₦150,000.00',
          },
        },
      },
    },
  })
  async getUserDetail(@Param('id') id: string) {
    return this.adminUserService.getUserDetail(id);
  }

  @Get(':id/user-info')
  @RequirePermissions(Permission.USER_ACCOUNT_ACCESS)
  @ApiOperation({ summary: '[ADMIN] Get user account info' })
  @ApiResponse({
    status: 200,
    description: 'User account information',
    schema: {
      example: {
        success: true,
        data: {
          userId: 'usr_123abc',
          accountName: 'John Doe',
          walletAddress: 'QDX_98HF23',
          email: 'john@example.com',
          phoneNumber: '+2348012345678',
          joinedDate: '2025-11-20T10:30:00.000Z',
          gender: 'M',
          status: 'ACTIVE',
        },
      },
    },
  })
  async getAccountInfo(@Param('id') id: string) {
    return this.adminUserService.getUserById(id);
  }

  @Get()
  @RequirePermissions(Permission.USER_ACCOUNT_ACCESS)
  @ApiOperation({ summary: '[ADMIN] Get all users' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of users',
    schema: {
      example: {
        success: true,
        data: [
          {
            userId: 'usr_123abc',
            accountName: 'John Doe',
            walletAddress: 'QDX_98HF23',
            email: 'john@example.com',
            phoneNumber: '+2348012345678',
            joinedDate: '2025-11-20T10:30:00.000Z',
            gender: 'M',
            status: 'ACTIVE',
          },
          {
            userId: 'usr_456def',
            accountName: 'Jane Smith',
            walletAddress: 'QDX_77KL91',
            email: 'jane@example.com',
            phoneNumber: 'N/A',
            joinedDate: '2025-10-01T14:15:00.000Z',
            gender: 'F',
            status: 'FLAGGED',
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
  async getAll(@Query() query: GetAdminUsersDto) {
    return this.adminUserService.getAllUsers(query);
  }

  @Get(':id/user-transactions-history')
  @RequirePermissions(Permission.DOWNLOAD_TRANSACTION_HISTORY)
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  @ApiOperation({
    summary: '[ADMIN] Get full transaction history for a specific user',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated transaction history for a user',
    schema: {
      example: {
        success: true,
        data: [
          {
            transactionId: 'txn_123abc',
            accountName: 'John Doe',
            walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            transactionType: 'WITHDRAWAL',
            amountToken: '1.5 ETH',
            status: 'COMPLETED',
            network: 'ETH',
            transactionContext: 'WITHDRAWAL',
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
  async getUserTransactions(
    @Param('id') userId: string,
    @Query() query: GetTransactionHistoryDto,
  ) {
    return this.adminUserService.getUserTransactionHistory(userId, query);
  }

  @Patch(':id/flag')
  @RequirePermissions(Permission.FLAG_USER)
  @AuditLog({
    action: AuditAction.ADMIN_FLAG_USER,
    resource: AuditResource.ADMIN_USER_MANAGEMENT,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({ summary: '[ADMIN] Flag a user and set reason' })
  @ApiBody({ type: FlagUserDto })
  async flagUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') userId: string,
    @Body() dto: FlagUserDto,
  ) {
    const adminId = req.user.id;
    return this.adminUserService.flagUser(adminId, userId, dto);
  }

  @Patch(':id/unflag')
  @RequirePermissions(Permission.FLAG_USER)
  @AuditLog({
    action: AuditAction.ADMIN_UNFLAG_USER,
    resource: AuditResource.ADMIN_USER_MANAGEMENT,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({ summary: '[ADMIN] Unflag a user and clear reason' })
  async unflagUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') userId: string,
  ) {
    const adminId = req.user.id;
    return this.adminUserService.unflagUser(adminId, userId);
  }
}
