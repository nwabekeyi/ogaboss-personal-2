import {
  Get,
  Query,
  Param,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AdminTransactionService } from './admin-transactions.service';
import {
  GetAdminTransactionsDto,
  ResolveWebhookDto,
  GetFailedWebhooksDto,
  DownloadUserTransactionHistoryDto,
  DownloadUsersTransactionHistoryDto,
  DownloadTransactionReceiptDto,
  DownloadMultipleTransactionReceiptsDto,
} from '../dto';
import {
  RequirePermissions,
  VersionedController,
} from '../../../core/decorators';
import { apiTags } from '../../../shared';
import { AdminRolesGuard } from '../../../core/guards';
import { AuthGuard, AuthenticatedRequest } from '../../../common';
import { Permission } from '../../../infrastructure';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Admin - Transactions')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.adminTransactions)
@UseGuards(AuthGuard, AdminRolesGuard)
export class AdminTransactionController {
  constructor(
    private readonly adminTransactionService: AdminTransactionService,
  ) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] Get all transactions' })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  @ApiResponse({
    status: 200,
    description: 'Paginated list of transactions',
    schema: {
      example: {
        success: true,
        data: [
          {
            transactionId: 'txn_123abc',
            accountName: 'John Doe',
            walletAddress: '1FfmbHfnpaZjKFvyi1okTjJJusN455paPH',
            transactionType: 'DEPOSIT',
            amountToken: '0.005 BTC',
            status: 'COMPLETED',
            network: 'BTC',
            transactionContext: 'DEPOSIT',
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
  async getAll(@Query() query: GetAdminTransactionsDto) {
    return this.adminTransactionService.getAllTransactions(query);
  }

  @Get('company-liquidity')
  @ApiOperation({
    summary:
      '[ADMIN] Get company liquidity and pending failed company-liquidity transactions',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async getCompanyLiquidityOverview() {
    return this.adminTransactionService.getCompanyLiquidityOverview();
  }

  @Get('failed-company/pending')
  @ApiOperation({
    summary: '[ADMIN] Get pending failed company-liquidity transactions',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async getPendingFailedCompanyTransactions() {
    return this.adminTransactionService.getPendingFailedCompanyTransactions();
  }

  @Post('failed-company/:id/activate')
  @AuditLog({
    action: AuditAction.ADMIN_ACTIVATE_FAILED_COMPANY_TRANSACTION,
    resource: AuditResource.ADMIN_TRANSACTIONS,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({
    summary: '[ADMIN] Activate a failed company-liquidity transaction',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async activateFailedCompanyTransaction(@Param('id') id: string) {
    return this.adminTransactionService.activateFailedCompanyTransaction(id);
  }

  @Post('failed-company/activate-all')
  @AuditLog({
    action: AuditAction.ADMIN_ACTIVATE_ALL_FAILED_COMPANY_TRANSACTIONS,
    resource: AuditResource.ADMIN_TRANSACTIONS,
  })
  @ApiOperation({
    summary:
      '[ADMIN] Activate all pending failed company-liquidity transactions',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async activateAllFailedCompanyTransactions() {
    return this.adminTransactionService.activateAllFailedCompanyTransactions();
  }

  @Get(':id')
  @ApiOperation({ summary: '[ADMIN] Get single transaction details' })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  @ApiResponse({
    status: 200,
    description: 'Single transaction detail',
    schema: {
      example: {
        success: true,
        data: {
          transactionId: 'txn_123abc',
          date: '2026-01-03T07:50:00.000Z',
          accountName: 'John Doe',
          walletAddress: '1FfmbHfnpaZjKFvyi1okTjJJusN455paPH',
          transactionType: 'DEPOSIT',
          amountToken: '0.005 BTC',
          status: 'COMPLETED',
          network: 'BTC',
          transactionContext: 'DEPOSIT',
          destinationWallet: 'BTC (BTC)',
          destinationAddress: '1FfmbHfnpaZjKFvyi1okTjJJusN455paPH',
          destinationTag: null,
        },
      },
    },
  })
  async getById(@Param('id') id: string) {
    return this.adminTransactionService.getTransactionById(id);
  }

  @Get('failed-webhooks')
  @ApiOperation({
    summary: '[ADMIN] Get unresolved failed webhooks for manual resolution',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  @ApiResponse({
    status: 200,
    description: 'Paginated list of unresolved failed webhooks',
  })
  async getFailedWebhooks(@Query() query: GetFailedWebhooksDto) {
    return this.adminTransactionService.getFailedWebhooks(query);
  }

  @Post('failed-webhooks/:id/resolve')
  @AuditLog({
    action: AuditAction.ADMIN_RESOLVE_FAILED_WEBHOOK,
    resource: AuditResource.ADMIN_WEBHOOKS,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({
    summary: '[ADMIN] Mark a failed webhook as resolved with a comment',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async resolveFailedWebhook(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ResolveWebhookDto,
  ) {
    const adminId = req.user.id;
    return this.adminTransactionService.resolveWebhook(
      id,
      dto.resolutionComment,
      adminId,
    );
  }

  @Post('download/user-history')
  @ApiOperation({
    summary: '[ADMIN] Download transaction history PDF for a single user',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async downloadUserTransactionHistory(
    @Body() dto: DownloadUserTransactionHistoryDto,
    @Res() res: Response,
  ) {
    const pdfBuffer =
      await this.adminTransactionService.generateUserTransactionHistoryPdf(dto);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="transaction-history-${dto.userId}-${Date.now()}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Post('download/users-history')
  @ApiOperation({
    summary: '[ADMIN] Download transaction history PDF for multiple users',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async downloadUsersTransactionHistory(
    @Body() dto: DownloadUsersTransactionHistoryDto,
    @Res() res: Response,
  ) {
    const pdfBuffer =
      await this.adminTransactionService.generateUsersTransactionHistoryPdf(
        dto,
      );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="transaction-history-multiple-${Date.now()}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get('download/receipt/:id')
  @ApiOperation({
    summary: '[ADMIN] Download receipt PDF for a single transaction',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  async downloadTransactionReceipt(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer =
      await this.adminTransactionService.generateTransactionReceiptPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}-${Date.now()}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Post('download/receipts')
  @ApiOperation({
    summary: '[ADMIN] Download receipt PDFs for multiple transactions',
  })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async downloadMultipleTransactionReceipts(
    @Body() dto: DownloadMultipleTransactionReceiptsDto,
    @Res() res: Response,
  ) {
    const pdfBuffer =
      await this.adminTransactionService.generateMultipleTransactionReceiptsPdf(
        dto.transactionIds,
      );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipts-${Date.now()}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }
}
