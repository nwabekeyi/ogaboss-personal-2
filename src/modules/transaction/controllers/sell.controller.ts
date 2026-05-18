// src/modules/transaction/controllers/sell.controller.ts
import {
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../core/guards/auth.guard';
import { AuthenticatedRequest } from '../../../common';
import { SellService } from '../services/sell.service';
import { PreviewSellDto, ConfirmSellDto } from '../dto';
import { apiTags } from '../../../shared';
import { VersionedController } from '../../../core';
import { TransactionLimitInterceptor } from '../interceptors/transaction-limit.interceptor';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags(`${apiTags.orders}-sell`)
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@UseInterceptors(TransactionLimitInterceptor)
@VersionedController('sell-order')
export class SellController {
  constructor(private readonly sellService: SellService) {}

  @Post('preview')
  @AuditLog({
    action: AuditAction.SELL_PREVIEW,
    resource: AuditResource.TRANSACTION_SELL,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a crypto sell transaction',
    description: `
## Overview
Creates a preview of a cryptocurrency sale, showing exactly how much NGN the user 
will receive for their crypto.

## Required Fields
- **quoteId**: The ID from a previously obtained sell quote

## Response Details
- **previewId**: Unique identifier for this preview - use in confirm endpoint
- **crypto**: The cryptocurrency being sold (e.g., BTC, USDT)
- **cryptoAmount**: Amount of crypto being sold
- **estimatedNgn**: Estimated NGN user will receive
- **transactionFee**: Platform fee in NGN
- **marketRate**: Raw market price without buffer
- **bufferedRate**: Final price after buffer deduction
- **buffer_percent**: Percentage deducted as buffer for price protection
- **expires_in**: How long this preview is valid (typically 30 seconds)
- **requiresPinVerification**: Whether PIN must be verified before confirming
- **message**: Additional information about the transaction

## Important Notes
- This is a preview only - no crypto is deducted yet
- Rates are locked for the duration shown in expires_in
- NGN will be credited to the user's internal NGN wallet upon completion
      `,
  })
  @ApiBody({ type: PreviewSellDto })
  @ApiResponse({
    status: 200,
    description: 'Sell preview data including crypto amount, fees, and rates',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid quote ID or quote expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async previewSell(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreviewSellDto,
  ) {
    return this.sellService.previewSell(req.user.id, dto);
  }

  @Post('confirm')
  @AuditLog({
    action: AuditAction.SELL_CONFIRM,
    resource: AuditResource.TRANSACTION_SELL,
    maskFields: ['previewId'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm and execute a crypto sell transaction',
    description: `
## Overview
Executes a previously previewed cryptocurrency sale. The user's crypto is debited 
and NGN is credited to their internal wallet.

## Required Fields
- **previewId**: The preview ID from the preview endpoint

## Flow
1. User gets a sell quote (quotes endpoint)
2. User previews the sale to see exact NGN amount
3. User verifies their PIN to unlock the quote
4. User calls this endpoint to confirm the sale

## Response Details
- **previewId**: Reference to the preview
- **sold**: Amount of cryptocurrency sold
- **currency**: Cryptocurrency sold
- **estimatedNgnCredit**: NGN amount to be credited to wallet
- **ngnCurrency**: The currency code (NGN)
- **status**: Current status (PROCESSING = processing the transaction)

## Important Notes
- Crypto is deducted immediately from user's wallet
- NGN is credited to internal wallet - not bank account
- For bank payout, user needs to initiate a withdrawal
- Transaction status will update as blockchain confirms the transfer
      `,
  })
  @ApiBody({ type: ConfirmSellDto })
  @ApiResponse({
    status: 200,
    description:
      'Sell order placed successfully. NGN will be credited to internal wallet once confirmed.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid preview ID, PIN not verified, or preview expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Insufficient crypto balance' })
  async confirmSell(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmSellDto,
  ) {
    return this.sellService.confirmSell(req.user.id, dto.previewId);
  }
}
