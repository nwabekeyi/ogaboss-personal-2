// src/modules/wallet/wallet.controller.ts
import {
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  UseInterceptors,
  Param,
} from '@nestjs/common';
import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../common';
import { HttpExceptionInterceptor, AuthGuard } from '../../core';
import { apiTags } from '../../shared';
import { WalletService } from './wallet.service';
import { UserService } from '../auth/users/users.service';
import { HttpException } from '@nestjs/common/exceptions';
import { VersionedController } from '../../core/decorators';
import {
  WalletSummaryResponseDto,
  PaymentAddressDto,
} from './dto/response.dto';

@ApiTags(apiTags.wallet)
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.wallet)
@UseGuards(AuthGuard)
@UseInterceptors(HttpExceptionInterceptor)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly userService: UserService,
  ) {}

  @Get('all-wallets')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Get all wallet balances for the authenticated user',
    description: `
## Overview
Retrieves all wallets associated with the authenticated user, including:
- Cryptocurrency wallets (BTC, USDT, ETH, etc.)
- Fiat wallets (NGN, USD)

Each wallet includes converted balances in both NGN and USD based on current market prices.

## Response Details
- **totalBalanceInNaira**: Sum of all wallet balances converted to NGN
- **totalReservedBalanceInNaira**: Total reserved balance in NGN
- **weeklyPercentChange**: Percentage change over the current week (Monday → Sunday)
- **trend**: Direction of change (1=up, 2=down, 0=no_change)
- **wallets**: Array of individual wallet details

## Wallet Details
Each wallet in the array contains:
- Current balance in original currency
- Price in NGN and USD
- Converted balance in NGN and USD
- Whether blockchain is enabled for deposits
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'All wallet balances retrieved successfully',
    type: WalletSummaryResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getAllUserWallets(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;

    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return await this.walletService.userWallets(userId);
  }

  @Get('payment-addresses/:walletId')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Get all payment addresses for a wallet',
    description: `
## Overview
Retrieves all active blockchain payment addresses associated with a specific wallet.

## Use Cases
- Display deposit addresses for users to receive cryptocurrency
- Show available networks for a specific currency wallet

## Requirements
- The wallet must belong to the authenticated user
- Only returns ACTIVE addresses (addresses that have been generated and are ready to use)

## Response Details
Each address contains:
- **address**: The blockchain wallet address
- **network**: The blockchain network (e.g., bitcoin, ethereum, tron)
- **currency**: The cryptocurrency for this address
- **destinationTag**: Required memo/tag for certain blockchains (XRP, XLM, etc.)
    `,
  })
  @ApiParam({
    name: 'walletId',
    type: String,
    example: '550e8400-e29b-41d4-a716-446655440000',
    description:
      'The unique identifier of the wallet to get payment addresses for',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment addresses retrieved successfully',
    type: [PaymentAddressDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found or does not belong to user',
  })
  async getPaymentAddresses(
    @Req() req: AuthenticatedRequest,
    @Param('walletId') walletId: string,
  ) {
    const userId = req.user.id;
    return await this.walletService.getWalletPaymentAddresses(userId, walletId);
  }
}
