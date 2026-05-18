import {
    Controller,
    Get,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
    Param,
  } from '@nestjs/common';
  import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiQuery,
    ApiResponse,
    ApiParam,
  } from '@nestjs/swagger';
  
  import { VersionedController } from '../../../core/decorators';
  import { AuthGuard } from '../../../core/guards/auth.guard';
  import { AuthenticatedRequest } from '../../../common';
  
  import { GetUserTransactionsDto } from '../dto/get-user-transactions.dto';
  import { TransactionQueryService } from '../services/transaction-query.service';
  import { apiTags } from '../../../shared';
  
  @ApiTags(`User-${apiTags.transaction}`)
  @ApiBearerAuth('Bearer')
  @VersionedController(apiTags.transaction)
  @UseGuards(AuthGuard)
  export class TransactionQueryController {
    constructor(private readonly transactionQueryService: TransactionQueryService) {}
  
    @Get('user')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
      summary: 'Get paginated list of user transactions',
      description:
        'Retrieves the authenticated user\'s transaction history with optional filters and pagination.',
    })
    @ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      description: 'Page number (starts at 1). Default: 1',
      example: 1,
    })
    @ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Items per page (1–100). Default: 20',
      example: 20,
    })
    @ApiQuery({
      name: 'status',
      required: false,
      type: String,
      description: 'Filter by transaction status (e.g., COMPLETED, PENDING)',
      example: 'COMPLETED',
    })
    @ApiQuery({
      name: 'type',
      required: false,
      type: String,
      description: 'Filter by transaction type (e.g., CREDIT, DEBIT)',
      example: 'CREDIT',
    })
    @ApiQuery({
      name: 'context',
      required: false,
      type: String,
      description: 'Filter by transaction context (e.g., DEPOSIT, WITHDRAWAL)',
      example: 'DEPOSIT',
    })
    @ApiQuery({
      name: 'currency',
      required: false,
      type: String,
      description: 'Filter by currency (case-insensitive)',
      example: 'BTC',
    })
    @ApiQuery({
      name: 'startDate',
      required: false,
      type: String,
      description: 'Filter transactions after this date (ISO format)',
      example: '2025-01-01T00:00:00.000Z',
    })
    @ApiQuery({
      name: 'endDate',
      required: false,
      type: String,
      description: 'Filter transactions before this date (ISO format)',
      example: '2025-12-31T23:59:59.999Z',
    })
    @ApiResponse({
      status: 200,
      description: 'Success: List of user transactions with pagination info.',
      schema: {
        example: {
          success: true,
          data: [
            {
              id: 'uuid',
              transactionUniqueId: 'tx_123456',
              currency: 'BTC',
              cryptoAmountOriginal: '0.0015',
              fiatAmountOriginal: '150000.00',
              status: 'COMPLETED',
              transactionType: 'CREDIT',
              transactionContext: 'DEPOSIT',
              paymentType: 'CRYPTO',
              network: 'btc',
              description: 'Deposit received: 0.0015 BTC',
              createdAt: '2026-02-01T12:00:00.000Z',
              receiverWalletAddress: 'bc1q...',
              senderWalletAddress: null,
              platformFeeOriginal: '0.00',
              networkFeeOriginal: '0.00001',
              totalAmountSentOriginal: '0.00149',
              paymentMetadata: { txid: 'abc123...' },
            },
            // ... more items
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 45,
            totalPages: 3,
            hasNext: true,
            hasPrev: false,
          },
        },
      },
    })
    @ApiResponse({
      status: 400,
      description: 'Bad Request (invalid pagination or filters)',
    })
    @ApiResponse({
      status: 401,
      description: 'Unauthorized (invalid/missing token)',
    })
    async getUserTransactions(
      @Req() req: AuthenticatedRequest,
      @Query() dto: GetUserTransactionsDto = {},
    ) {
      return this.transactionQueryService.getUserTransactions(req.user.id, dto);
    }

    @Get('recent')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Get the 5 most recent transactions' })
    @ApiResponse({ status: 200, description: 'List of up to 5 recent transactions' })
    async getRecentTransactions(@Req() req: AuthenticatedRequest) {
      return this.transactionQueryService.getRecentTransactions(req.user.id);
    }

    @Get(':id')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Get a single transaction by ID' })
    @ApiParam({ name: 'id', description: 'Internal transaction UUID' })
    @ApiResponse({ status: 200, description: 'Transaction details' })
    @ApiResponse({ status: 404, description: 'Transaction not found' })
    async getTransactionById(
      @Req() req: AuthenticatedRequest,
      @Param('id') id: string,
    ) {
      return this.transactionQueryService.getTransactionById(req.user.id, id);
    }
  }