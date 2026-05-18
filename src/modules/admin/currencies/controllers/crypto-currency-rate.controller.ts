import { Get, Patch, Param, Body, UseGuards, Req, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard, AdminRolesGuard } from '../../../../common';
import { VersionedController } from '../../../../core/decorators';
import { AuthenticatedRequest } from '../../../../common/types';
import { CryptoCurrencyRateService } from '../services/crypto-currency-rate.service';
import {
  UpdateCryptoCurrencyRateDto,
  BulkUpdateCryptoCurrencyRateDto,
} from '../../dto/update-crypto-currency-rate.dto';
import { apiTags } from '../../../../shared';
import { RequirePermissions } from '../../../../core/decorators';
import { Permission } from '../../../../infrastructure';
import { AuditLog, AuditAction, AuditResource } from '../../../../core/audit';

@ApiTags('Admin - Crypto Interest Rates')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.cryptoCurrencyRate)
export class CryptoCurrencyRateController {
  constructor(
    private readonly cryptoCurrencyRateService: CryptoCurrencyRateService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get all crypto interest rates' })
  @ApiResponse({
    status: 200,
    description: 'List of crypto interest rates retrieved successfully',
    schema: {
      example: {
        success: true,
        message: 'Crypto interest rates retrieved successfully',
        data: [
          {
            cryptoId: 'abc123',
            symbol: 'BTC',
            name: 'Bitcoin',
            interestRatePercent: 5.5,
            lockedFundsInterestRatePercent: 10,
          },
          {
            cryptoId: 'def456',
            symbol: 'ETH',
            name: 'Ethereum',
            interestRatePercent: 3.2,
            lockedFundsInterestRatePercent: 8,
          },
        ],
      },
    },
  })
  async getAllRates() {
    return this.cryptoCurrencyRateService.getAllCryptoCurrencyRates();
  }

  @Get(':cryptoId')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get crypto interest rate for a specific cryptocurrency',
  })
  @ApiParam({ name: 'cryptoId', description: 'ID of the cryptocurrency' })
  @ApiResponse({
    status: 200,
    description: 'Crypto interest rate retrieved successfully',
  })
  async getRate(@Param('cryptoId') cryptoId: string) {
    return this.cryptoCurrencyRateService.getCryptoCurrencyRate(cryptoId);
  }

  @Patch(':cryptoId')
  @AuditLog({
    action: AuditAction.ADMIN_UPDATE_CRYPTO_CURRENCY_RATE,
    resource: AuditResource.ADMIN_CRYPTO_CURRENCY_RATE,
    resourceIdPath: 'params.cryptoId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({
    summary:
      '[ADMIN] Update interest rate and locked funds interest rate for a cryptocurrency',
  })
  @ApiParam({ name: 'cryptoId', description: 'ID of the cryptocurrency' })
  @ApiBody({ type: UpdateCryptoCurrencyRateDto })
  @ApiResponse({
    status: 200,
    description: 'Crypto interest rate updated successfully',
    schema: {
      example: {
        success: true,
        message: 'Crypto interest rate updated successfully',
        data: {
          cryptoId: 'abc123',
          symbol: 'BTC',
          name: 'Bitcoin',
          interestRatePercent: 5.5,
          lockedFundsInterestRatePercent: 10,
        },
      },
    },
  })
  async updateRate(
    @Param('cryptoId') cryptoId: string,
    @Body() dto: UpdateCryptoCurrencyRateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cryptoCurrencyRateService.updateCryptoCurrencyRate(
      cryptoId,
      dto,
    );
  }

  @Patch('bulk')
  @AuditLog({
    action: AuditAction.ADMIN_BULK_UPDATE_CRYPTO_CURRENCY_RATES,
    resource: AuditResource.ADMIN_CRYPTO_CURRENCY_RATE,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({
    summary: '[ADMIN] Bulk update interest rates for multiple cryptocurrencies',
  })
  @ApiBody({ type: BulkUpdateCryptoCurrencyRateDto })
  @ApiResponse({
    status: 200,
    description: 'Bulk update processed successfully',
  })
  async bulkUpdateRates(
    @Body() dto: BulkUpdateCryptoCurrencyRateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cryptoCurrencyRateService.bulkUpdateCryptoCurrencyRates(dto);
  }

  @Post('initialize')
  @AuditLog({
    action: AuditAction.ADMIN_INITIALIZE_CRYPTO_CURRENCY_RATES,
    resource: AuditResource.ADMIN_CRYPTO_CURRENCY_RATE,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({
    summary: '[ADMIN] Initialize missing crypto interest rates (set to 0)',
  })
  @ApiResponse({
    status: 200,
    description: 'Missing rates initialized successfully',
  })
  async initializeRates(@Req() req: AuthenticatedRequest) {
    return this.cryptoCurrencyRateService.initializeMissingRates();
  }
}
