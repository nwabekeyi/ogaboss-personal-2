// src/modules/transaction/controllers/quotes.controller.ts
import {
  Body,
  Post,
  Get,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';

import { VersionedController } from '../../../core/decorators';
import { AuthGuard } from '../../../core/guards/auth.guard';
import { AuthenticatedRequest } from '../../../common';

import {
  BuyQuoteDto,
  SellQuoteDto,
  SwapQuoteDto,
  VerifyPinForQuoteDto,
  TransactionLimitsDto,
} from '../dto';

import { QuotationService } from '../services';
import { apiTags } from '../../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags(`${apiTags.orders}-quotes`)
@ApiBearerAuth('Bearer')
@VersionedController('order-quotes')
@UseGuards(AuthGuard)
export class QuotesController {
  constructor(private readonly quotationService: QuotationService) {}

  // =====================================================
  // BUY QUOTE
  // =====================================================
  @Post('buy')
  @AuditLog({
    action: AuditAction.QUOTE_BUY,
    resource: AuditResource.TRANSACTION_QUOTE,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get buy quote for purchasing cryptocurrency',
    description: `
## Overview
Calculates the amount of cryptocurrency a user will receive when spending 
a specific amount of NGN.

## Required Fields
- **fiatAmount**: Amount in NGN the user wants to spend
- **crypto**: The cryptocurrency to buy (e.g., BTC, USDT, ETH)
- **network**: The blockchain network (optional, uses default if not provided)

## Response Details
- **id**: Unique quote ID - use this in the buy preview/confirm endpoints
- **side**: Always 'buy'
- **crypto**: Cryptocurrency being purchased
- **network**: Blockchain network for the crypto
- **fiatCurrency**: Always 'NGN'
- **cryptoVolume**: The Naira amount entered
- **transactionFee**: Platform fee in Naira
- **market_rate**: Raw market price without buffer
- **buffered_rate**: Final price with safety buffer added
- **actual_buffer_amount**: Naira value of the buffer margin
- **buffer_percent**: Percentage markup applied
- **expires_in**: How long quote is valid (typically '30s')

## Important Notes
- Quotes expire quickly (30 seconds) - prices change rapidly
- Use the quote ID in the buy preview endpoint to complete the transaction
- The buffered rate protects against price slippage during processing
- Market rate shown is the rate at time of quote creation
      `,
  })
  @ApiBody({ type: BuyQuoteDto })
  @ApiResponse({
    status: 200,
    description: 'Buy quote calculated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or unsupported currency',
  })
  @ApiResponse({
    status: 422,
    description: 'Amount below minimum transaction limit',
  })
  async getBuyQuote(
    @Req() req: AuthenticatedRequest,
    @Body() dto: BuyQuoteDto,
  ) {
    return this.quotationService.getBuyQuote(req.user.id, dto);
  }

  // =====================================================
  // SELL QUOTE
  // =====================================================
  @Post('sell')
  @AuditLog({
    action: AuditAction.QUOTE_SELL,
    resource: AuditResource.TRANSACTION_QUOTE,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get sell quote for selling cryptocurrency',
    description: `
## Overview
Calculates the amount of NGN a user will receive when selling a specific 
amount of cryptocurrency.

## Required Fields
- **cryptoAmount**: Amount of cryptocurrency to sell
- **crypto**: The cryptocurrency to sell (e.g., BTC, USDT, ETH)
- **network**: The blockchain network (optional, uses default if not provided)

## Response Details
- **id**: Unique quote ID - use this in the sell preview/confirm endpoints
- **side**: Always 'sell'
- **crypto**: Cryptocurrency being sold
- **network**: Blockchain network for the crypto
- **fiatCurrency**: Always 'NGN'
- **cryptoAmount**: The crypto amount entered
- **estimatedFiat**: Net Naira amount after fees
- **transactionFee**: Platform fee in Naira
- **market_rate**: Raw market price without buffer
- **buffered_rate**: Final price with safety buffer deducted
- **actual_buffer_amount**: Naira value subtracted as buffer
- **buffer_percent**: Percentage markdown applied
- **expires_in**: How long quote is valid (typically '30s')

## Important Notes
- Quotes expire quickly (30 seconds)
- Buffer is deducted from the rate to protect against price drops during processing
- Use the quote ID in the sell preview endpoint to complete the transaction
- Estimated fiat is what user will receive after all fees
      `,
  })
  @ApiBody({ type: SellQuoteDto })
  @ApiResponse({
    status: 200,
    description: 'Sell quote calculated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or unsupported currency',
  })
  @ApiResponse({ status: 422, description: 'Insufficient crypto balance' })
  async getSellQuote(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SellQuoteDto,
  ) {
    return this.quotationService.getSellQuote(req.user.id, dto);
  }

  // =====================================================
  // SWAP QUOTE
  // =====================================================
  @Post('swap')
  @AuditLog({
    action: AuditAction.QUOTE_SWAP,
    resource: AuditResource.TRANSACTION_QUOTE,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get swap quote for crypto-to-crypto exchange',
    description: `
## Overview
Calculates the amount of target cryptocurrency a user will receive when 
swapping from one cryptocurrency to another.

## Required Fields
- **amountIn**: Amount of source cryptocurrency to swap
- **from**: Source cryptocurrency symbol (e.g., BTC)
- **fromNetwork**: Source blockchain network
- **to**: Target cryptocurrency symbol (e.g., USDT)
- **toNetwork**: Target blockchain network

## Response Details
- **id**: Unique quote ID - use this in the swap preview/confirm endpoints
- **from**: Source cryptocurrency
- **to**: Target cryptocurrency
- **fromNetwork**: Source blockchain
- **toNetwork**: Target blockchain
- **amountIn**: Amount being swapped
- **estimatedOut**: Exact amount of target crypto to receive
- **transactionFee**: Platform fee (currently 0 for swaps)
- **marketRate**: Raw exchange rate
- **protectedRate**: Rate after buffer protection
- **actual_buffer_amount**: Value lost to buffer in target currency
- **totalBufferPercent**: Combined protection percentage
- **expiresIn**: How long quote is valid (typically '30s')

## Important Notes
- Swaps are internal - no blockchain transfer needed
- Both currencies must be different
- Networks can be the same or different (e.g., BTC → USDT on different networks)
- Use the quote ID in the swap preview endpoint to complete the swap
      `,
  })
  @ApiBody({ type: SwapQuoteDto })
  @ApiResponse({
    status: 200,
    description: 'Swap quote calculated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or unsupported currencies',
  })
  @ApiResponse({ status: 422, description: 'Insufficient balance for swap' })
  async getSwapQuote(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SwapQuoteDto,
  ) {
    return this.quotationService.getSwapQuote(req.user.id, dto);
  }

  // =====================================================
  // VERIFY PIN FOR QUOTE
  // =====================================================
  @Post('verify-pin')
  @AuditLog({
    action: AuditAction.QUOTE_VERIFY_PIN,
    resource: AuditResource.TRANSACTION_QUOTE,
    maskFields: ['pin'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify PIN to unlock a quote for execution',
    description: `
## Overview
Verifies the user's PIN to unlock a quote for execution. This is required 
before confirming buy, sell, or swap transactions.

## Required Fields
- **previewId**: The quote/preview ID to unlock
- **pin**: User's 6-digit PIN

## Important Notes
- PIN verification locks the quote for execution
- Without PIN verification, the confirm endpoint will fail
- PIN verification is valid only while the quote is still active
- Quote becomes invalid if PIN verification succeeds but user doesn't confirm in time
    `,
  })
  @ApiBody({ type: VerifyPinForQuoteDto })
  @ApiResponse({
    status: 200,
    description: 'PIN verified, quote unlocked for execution',
  })
  @ApiResponse({ status: 400, description: 'Invalid PIN' })
  @ApiResponse({ status: 422, description: 'Quote expired or not found' })
  async verifyQuote(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyPinForQuoteDto,
  ) {
    await this.quotationService.verifyPinForQuote(
      req.user.id,
      dto.previewId,
      dto.pin,
    );
    return {
      success: true,
      message: 'PIN verified successfully',
    };
  }

  // =====================================================
  // TRANSACTION LIMITS
  // =====================================================
  @Get('limits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get transaction limits for a cryptocurrency',
    description: `
## Overview
Returns the minimum and maximum transaction limits for a given cryptocurrency.
The minimum is always 10 USDT equivalent, and the maximum is based on the user's tier limit.

## Required Fields
- **crypto**: The cryptocurrency symbol (e.g., BTC, USDT, ETH)
- **network**: The blockchain network (optional)

## Response Details
- **crypto**: The cryptocurrency symbol
- **network**: The blockchain network
- **minimum.amount**: Minimum amount in crypto units
- **minimum.usdtEquivalent**: Always 10 USDT
- **minimum.ngnValue**: Minimum amount in NGN
- **maximum.amount**: Maximum amount in crypto units (or 'unlimited')
- **maximum.ngnValue**: Maximum amount in NGN (or 'unlimited')
- **maximum.tier**: User's current tier
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction limits retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or unsupported currency',
  })
  async getTransactionLimits(
    @Req() req: AuthenticatedRequest,
    @Query() dto: TransactionLimitsDto,
  ) {
    return this.quotationService.getTransactionLimits(
      req.user.id,
      dto.crypto,
    );
  }
}
