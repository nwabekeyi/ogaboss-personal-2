// src/modules/transaction/controllers/swap.controller.ts
import {
  Controller,
  Post,
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
import { SwapService } from '../services/swap.service';
import { PreviewSwapDto, ConfirmSwapDto } from '../dto';
import { apiTags } from '../../../shared';
import { VersionedController } from '../../../core';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags(`${apiTags.orders}-swap`)
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController('swap-order')
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  // =====================================================
  // PREVIEW SWAP
  // =====================================================
  @Post('preview')
  @AuditLog({
    action: AuditAction.SWAP_PREVIEW,
    resource: AuditResource.TRANSACTION_SWAP,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a crypto-to-crypto swap',
    description: `
## Overview
Creates a preview of a cryptocurrency exchange, showing exactly how much of the 
target currency the user will receive.

## Required Fields
- **quoteId**: The ID from a previously obtained swap quote

## Response Details
- **previewId**: Unique identifier for this preview - use in confirm endpoint
- **from**: Source cryptocurrency being given (e.g., BTC)
- **to**: Target cryptocurrency being received (e.g., USDT)
- **amountIn**: Amount of source crypto being traded
- **estimatedOut**: Estimated amount of target crypto to receive
- **fee**: Platform fee (currently 0 for swaps)
- **marketRate**: Raw exchange rate between the two cryptos
- **protectedRate**: Rate after applying buffer protection
- **totalBufferPercent**: Combined protection percentage for both directions
- **expires_in**: How long this preview is valid (typically 30 seconds)
- **requiresPinVerification**: Whether PIN must be verified before confirming

## Important Notes
- This is a preview only - no crypto is deducted yet
- Rates are locked for the duration shown in expires_in
- Swap happens internally - no blockchain transfer needed
- Both assets use internal wallet balances
      `,
  })
  @ApiBody({ type: PreviewSwapDto })
  @ApiResponse({
    status: 200,
    description: 'Swap preview data including amounts, fees, and rates',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid quote ID or quote expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async previewSwap(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreviewSwapDto,
  ) {
    return this.swapService.previewSwap(req.user.id, dto);
  }

  // =====================================================
  // CONFIRM SWAP
  // =====================================================
  @Post('confirm')
  @AuditLog({
    action: AuditAction.SWAP_CONFIRM,
    resource: AuditResource.TRANSACTION_SWAP,
    maskFields: ['previewId'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm and execute a crypto-to-crypto swap',
    description: `
## Overview
Executes a previously previewed cryptocurrency swap. Source crypto is debited 
and target crypto is credited to the user's wallet.

## Required Fields
- **previewId**: The preview ID from the preview endpoint

## Flow
1. User gets a swap quote (quotes endpoint)
2. User previews the swap to see exact output amount
3. User verifies their PIN to unlock the quote
4. User calls this endpoint to confirm the swap

## Response Details
- **success**: Whether the swap was initiated successfully
- **swapId**: Internal swap identifier
- **fromCurrency**: Source cryptocurrency
- **fromAmount**: Amount of source crypto debited
- **toCurrency**: Target cryptocurrency
- **toAmount**: Amount of target crypto to be credited
- **status**: Current status (PROCESSING = processing internally)

## Important Notes
- Source crypto is deducted immediately from user's wallet
- Target crypto is credited via internal processing - not blockchain transfer
- Both wallets are updated atomically
- Transaction completes quickly since it's internal
      `,
  })
  @ApiBody({ type: ConfirmSwapDto })
  @ApiResponse({
    status: 200,
    description:
      'Swap execution initiated; user wallets will be updated via webhook',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid preview ID, PIN not verified, or preview expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 422,
    description: 'Insufficient source crypto balance',
  })
  async confirmSwap(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmSwapDto,
  ) {
    return this.swapService.confirmSwap(req.user.id, dto);
  }
}
