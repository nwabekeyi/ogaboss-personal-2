// src/modules/transaction/controllers/buy.controller.ts
import {
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
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
import { BuyService } from '../services/buy.service';
import { PreviewBuyDto, ConfirmBuyDto } from '../dto';
import { apiTags, BASE_CURRENCY } from '../../../shared';
import { VersionedController } from '../../../core';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags(`${apiTags.orders}-buy`)
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController('buy-order')
export class BuyController {
  constructor(private readonly buyService: BuyService) {}

  // =====================================================
  // GET PAYMENT METHODS
  // =====================================================
  @Get('payment-methods')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get available payment methods for buying crypto',
    description: `
## Overview
Retrieves all available payment methods users can use to pay for cryptocurrency purchases.

## Payment Types
- **CARD**: Pay using a previously saved debit/credit card
- **PAYSTACK**: Pay using Paystack (new card or bank transfer)

## Use Cases
- Display available payment options on the checkout page
- Allow users to select their preferred payment method before buying crypto
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'List of available payment methods retrieved successfully',
    type: Object,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
  })
  async getPaymentMethods() {
    return {
      message: 'Payment methods retrieved successfully',
      data: this.buyService.getPaymentMethods(),
    };
  }

  // =====================================================
  // PREVIEW BUY
  // =====================================================
  @Post('preview')
  @AuditLog({
    action: AuditAction.BUY_PREVIEW,
    resource: AuditResource.TRANSACTION_BUY,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a crypto purchase before buying',
    description: `
## Overview
Creates a preview of a cryptocurrency purchase using a previously obtained quote ID.
This shows the user exactly what they'll get before committing to the purchase.

## Required Fields
- **quoteId**: The ID from a previously obtained buy quote

## Response Details
- **previewId**: Unique identifier for this preview - use in confirm endpoint
- **crypto**: The cryptocurrency being purchased (e.g., BTC, USDT)
- **fiatAmount**: Amount in NGN the user is spending
- **estimatedCrypto**: Estimated crypto amount user will receive
- **transaction_fee**: Platform fee in NGN
- **total**: Total amount to be paid (fiatAmount + fees)
- **market_rate**: Raw market price without buffer
- **buffered_rate**: Final price including safety buffer
- **buffer_percent**: Percentage added as buffer for price protection
- **paymentDetails**: Bank transfer instructions (for BANK_TRANSFER payment type)
- **expires_in**: How long this preview is valid (typically 30 seconds)

## Important Notes
- This is a preview only - no actual transaction is created
- Rates are locked for the duration shown in expires_in
- After preview expires, user must get a new quote
    `,
  })
  @ApiBody({ type: PreviewBuyDto })
  @ApiResponse({
    status: 200,
    description: 'Buy preview data including crypto amount, fees, and rates',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid quote ID or quote expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async previewBuy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreviewBuyDto,
  ) {
    return this.buyService.previewBuy(req.user.id, dto);
  }

  // =====================================================
  // CONFIRM BUY
  // =====================================================
  @Post('confirm')
  @AuditLog({
    action: AuditAction.BUY_CONFIRM,
    resource: AuditResource.TRANSACTION_BUY,
    maskFields: ['previewId'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm and execute a crypto purchase',
    description: `
## Overview
Executes a previously previewed cryptocurrency purchase. Requires PIN verification 
to confirm the transaction.

## Required Fields
- **previewId**: The preview ID from the preview endpoint

## Flow
1. User gets a quote (quotes endpoint)
2. User previews the purchase to see exact amounts
3. User verifies their PIN to unlock the quote
4. User calls this endpoint to confirm the purchase

## Response Details
- **orderId**: Internal order identifier
- **quidaxOrderId**: Order ID from the exchange provider
- **quidaxReference**: Unique reference for tracking
- **received**: Amount of crypto to be credited
- **currency**: Cryptocurrency purchased
- **totalPaid**: Total amount paid in NGN
- **status**: Current status (PROCESSING = awaiting blockchain confirmation)

## Important Notes
- Crypto is NOT immediately available - waits for blockchain confirmation
- Check transaction status for updates on when crypto is credited
- If payment is via bank transfer, user must complete the transfer within the validity period
    `,
  })
  @ApiBody({ type: ConfirmBuyDto })
  @ApiResponse({
    status: 200,
    description:
      'Buy order placed successfully. Crypto will be credited once confirmed.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid preview ID, PIN not verified, or preview expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 422,
    description: 'Insufficient wallet balance or limits exceeded',
  })
  async confirmBuy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmBuyDto,
  ) {
    return this.buyService.confirmBuy(req.user.id, dto.previewId);
  }
}
