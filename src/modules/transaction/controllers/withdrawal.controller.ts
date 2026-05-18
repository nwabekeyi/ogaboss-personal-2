// src/modules/transaction/controllers/withdrawal.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../core/guards/auth.guard';
import { AuthenticatedRequest } from '../../../common';
import { WithdrawalService } from '../services/withdrawal.service';
import { CreateSendPreviewDto, ConfirmSendDto } from '../dto';
import { apiTags } from '../../../shared';
import { VersionedController } from '../../../core';
import { TransactionLimitInterceptor } from '../interceptors/transaction-limit.interceptor';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags(`${apiTags.orders}-withdrawal`)
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@UseInterceptors(TransactionLimitInterceptor)
@VersionedController('withdrawal')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  // =====================================================
  // PREVIEW WITHDRAWAL
  // =====================================================
  @Post('preview')
  @AuditLog({
    action: AuditAction.WITHDRAWAL_PREVIEW,
    resource: AuditResource.TRANSACTION_WITHDRAWAL,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a crypto withdrawal',
    description: `
## Overview
Creates a preview of a cryptocurrency withdrawal, showing exactly how much 
will be deducted from the user's wallet including all fees.

## Required Fields
- **quoteId**: The ID from a previously obtained withdrawal quote

## Response Details
- **previewId**: Unique identifier for this preview
- **currency**: Cryptocurrency being withdrawn
- **network**: Blockchain network (e.g., bitcoin, ethereum)
- **requestedSendAmount**: Amount the recipient will receive
- **networkFee**: Blockchain network fee (goes to miners/validators)
- **platformFee**: Platform service fee
- **totalToBeDeducted**: Total deduction from user wallet
- **marketRateAtPreview**: Current market rate at time of preview
- **expiresIn**: How long this preview is valid (in seconds)
- **note**: Informational message about preview

## Important Notes
- This is a preview only - no crypto is sent yet
- Network fees vary by blockchain and current congestion
- Total deducted = requested amount + network fee + platform fee
- Rates are locked for the duration shown in expiresIn
    `,
  })
  @ApiBody({ type: CreateSendPreviewDto })
  @ApiResponse({
    status: 200,
    description: 'Withdrawal preview data with fees and total deduction',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid quote ID or quote expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async previewWithdrawal(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSendPreviewDto,
  ) {
    return this.withdrawalService.previewSend(req.user.id, dto);
  }

  // =====================================================
  // CONFIRM WITHDRAWAL
  // =====================================================
  @Post('confirm')
  @AuditLog({
    action: AuditAction.WITHDRAWAL_CONFIRM,
    resource: AuditResource.TRANSACTION_WITHDRAWAL,
    maskFields: ['previewId'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm and execute a crypto withdrawal',
    description: `
## Overview
Executes a previously previewed cryptocurrency withdrawal. The user's crypto is 
debited and sent to the specified blockchain address.

## Required Fields
- **previewId**: The preview ID from the preview endpoint

## Flow
1. User gets a withdrawal quote (quotes endpoint)
2. User previews the withdrawal to see exact fees and deduction
3. User verifies their PIN to unlock the quote
4. User calls this endpoint to confirm the withdrawal

## Response Details
- **success**: Whether the withdrawal was initiated
- **transactionId**: Internal transaction identifier
- **withdrawalId**: Internal withdrawal identifier
- **providerWithdrawalId**: ID from the blockchain provider
- **status**: Current status (processing, pending, completed, failed)
- **requestedAmount**: Amount requested to be sent
- **message**: Status message about the withdrawal

## Important Notes
- Crypto is deducted immediately from user's wallet
- Actual blockchain transfer happens asynchronously
- User can track status via transaction ID
- Some withdrawals may require manual review
- Network confirmation depends on blockchain conditions
    `,
  })
  @ApiBody({ type: ConfirmSendDto })
  @ApiResponse({
    status: 200,
    description:
      'Withdrawal execution initiated; awaiting provider confirmation',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid preview ID, PIN not verified, or preview expired',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Insufficient wallet balance' })
  async confirmWithdrawal(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmSendDto,
  ) {
    return this.withdrawalService.confirmSend(req.user.id, dto);
  }

  // =====================================================
  // CANCEL WITHDRAWAL
  // =====================================================
  @Post(':transactionId/cancel')
  @AuditLog({
    action: AuditAction.WITHDRAWAL_CANCEL,
    resource: AuditResource.TRANSACTION_WITHDRAWAL,
    resourceIdPath: 'params.transactionId',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending withdrawal',
    description: `
## Overview
Attempts to cancel a withdrawal that is still in pending or processing status.
Not all withdrawals can be cancelled - depends on blockchain confirmation status.

## Use Cases
- User made a mistake in the withdrawal address
- User wants to stop the withdrawal before it's confirmed on blockchain

## Important Notes
- Only withdrawals that haven't been finalized on the blockchain can be cancelled
- If withdrawal is already confirmed, cancellation will fail
- If cancellation succeeds, crypto is returned to user's wallet
- The withdrawal ID is the same as the transaction ID from the confirm response
    `,
  })
  @ApiParam({
    name: 'transactionId',
    type: String,
    description: 'The withdrawal/transaction ID to cancel',
    example: 'wd_abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Withdrawal cancelled successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Withdrawal cannot be cancelled (already processed)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Withdrawal not found' })
  async cancelWithdrawal(
    @Req() req: AuthenticatedRequest,
    @Param('transactionId') withdrawalId: string,
  ) {
    return this.withdrawalService.cancelWithdrawal(req.user.id, withdrawalId);
  }
}
