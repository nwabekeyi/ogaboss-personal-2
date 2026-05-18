// src/modules/currency/currency.controller.ts
import {
  Get,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  Body,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { CurrencyService } from './currency.service';
import { HttpExceptionInterceptor } from '../../core';
import { apiTags } from '../../shared';
import { AuthGuard } from '../../core';
import { VersionedController } from '../../core/decorators';

@ApiTags(apiTags.currencies)
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.currencies)
@UseInterceptors(HttpExceptionInterceptor)
@UseGuards(AuthGuard)
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  // =====================================================
  // GET ALL CURRENCIES
  // =====================================================
  @Get('all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all supported cryptocurrencies',
    description: `
## Overview
Returns a list of all cryptocurrencies supported by the platform for trading.

## Response Details
Each currency contains:
- **id**: Unique identifier
- **name**: Full name (e.g., Bitcoin)
- **symbol**: Trading symbol (e.g., BTC)
- **type**: Whether crypto or fiat
- **networks**: Supported blockchain networks
- **isActive**: Whether the currency is available for trading
- **minimumTransaction**: Minimum transaction amount

## Use Cases
- Display available currencies for trading
- Show supported crypto options to users
- Build currency selection dropdowns
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'List of cryptocurrencies',
    schema: {
      example: {
        currencies: [
          {
            id: 'btc',
            name: 'Bitcoin',
            symbol: 'BTC',
            type: 'CRYPTO',
            networks: ['bitcoin'],
            isActive: true,
            minimumTransaction: '0.0001',
          },
          {
            id: 'usdt',
            name: 'Tether',
            symbol: 'USDT',
            type: 'CRYPTO',
            networks: ['ethereum', 'tron', 'bsc'],
            isActive: true,
            minimumTransaction: '1',
          },
        ],
      },
    },
  })
  getAllCurrencies() {
    return this.currencyService.getAllCurrencies();
  }

  // =====================================================
  // GET CURRENCY BY ID
  // =====================================================
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a cryptocurrency by ID',
    description: `
## Overview
Retrieves detailed information about a specific cryptocurrency.

## Parameters
- **id**: The currency ID (e.g., btc, eth, usdt)

## Response Details
- All currency properties including networks, limits, and status
    `,
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The currency ID to retrieve',
    example: 'btc',
  })
  @ApiResponse({
    status: 200,
    description: 'Currency details retrieved',
  })
  @ApiResponse({ status: 404, description: 'Currency not found' })
  findOne(@Param('id') id: string) {
    return this.currencyService.findOne(id);
  }

  // =====================================================
  // GET CURRENCY BY SYMBOL
  // =====================================================
  @Get('symbol/:symbol')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get cryptocurrency by symbol',
    description: `
## Overview
Retrieves cryptocurrency information using its trading symbol.

## Parameters
- **symbol**: The trading symbol (e.g., BTC, ETH, USDT)

## Use Cases
- Quick lookup by symbol (case-insensitive)
- Useful when user enters symbol directly
    `,
  })
  @ApiParam({
    name: 'symbol',
    type: String,
    description: 'The currency symbol (case-insensitive)',
    example: 'BTC',
  })
  @ApiResponse({
    status: 200,
    description: 'Currency details retrieved',
  })
  @ApiResponse({ status: 404, description: 'Currency not found' })
  findBySymbol(@Param('symbol') symbol: string) {
    return this.currencyService.findBySymbol(symbol.toLowerCase());
  }
}
