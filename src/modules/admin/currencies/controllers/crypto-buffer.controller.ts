import {
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
  Post,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard, AdminRolesGuard } from '../../../../common';
import { VersionedController } from '../../../../core/decorators';
import { AuthenticatedRequest } from '../../../../common/types';
import { CryptoBufferService } from '../services/crypto-buffer-rate.service';
import {
  PatchCryptoDto,
  BulkPatchCryptoDto,
  CreateBufferTierDto,
} from '../../dto';
import { apiTags } from '../../../../shared';
import { RequirePermissions } from '../../../../core/decorators';
import { Permission } from '../../../../infrastructure';
import { AuditLog, AuditAction, AuditResource } from '../../../../core/audit';

@ApiTags('Admin - Crypto Management')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.cryptoBuffer)
export class CryptoBufferController {
  constructor(private readonly cryptoBufferService: CryptoBufferService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get all cryptocurrencies' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Optional search by name or symbol',
  })
  @ApiResponse({
    status: 200,
    description: 'List of cryptocurrencies retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'abc123',
            symbol: 'BTC',
            name: 'Bitcoin',
            logoUrl: null,
            description: null,
          },
          {
            id: 'def456',
            symbol: 'ETH',
            name: 'Ethereum',
            logoUrl: null,
            description: null,
          },
        ],
      },
    },
  })
  async getAllCryptos(@Query('search') search?: string) {
    return this.cryptoBufferService.getAllCryptocurrencies(search);
  }

  @Get(':cryptoId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get buffer configuration for a cryptocurrency' })
  @ApiParam({ name: 'cryptoId', description: 'ID of the cryptocurrency' })
  @ApiResponse({
    status: 200,
    description: 'Buffer configuration retrieved successfully',
  })
  async getCryptoBuffer(@Param('cryptoId') cryptoId: string) {
    return this.cryptoBufferService.getCryptoBufferConfig(cryptoId);
  }

  @Post(':cryptoId/buffer-tiers')
  @AuditLog({
    action: AuditAction.ADMIN_CREATE_BUFFER_TIER,
    resource: AuditResource.ADMIN_CRYPTO_BUFFER,
    resourceIdPath: 'params.cryptoId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({
    summary: '[ADMIN] Create a new buffer tier for a cryptocurrency',
  })
  @ApiParam({ name: 'cryptoId', description: 'ID of the cryptocurrency' })
  @ApiBody({ type: CreateBufferTierDto })
  @ApiResponse({
    status: 201,
    description: 'Buffer tier created successfully',
    schema: {
      example: {
        success: true,
        message: 'Buffer tier created successfully',
        data: {
          id: 'tier123',
          cryptoId: 'abc123',
          orderType: 'BUY',
          minAmount: '0.01',
          maxAmount: '1',
          bufferPercent: 1.5,
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        },
      },
    },
  })
  async createBufferTier(
    @Param('cryptoId') cryptoId: string,
    @Body() dto: CreateBufferTierDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cryptoBufferService.createBufferTier(cryptoId, dto);
  }

  @Patch(':cryptoId')
  @AuditLog({
    action: AuditAction.ADMIN_PATCH_CRYPTO,
    resource: AuditResource.ADMIN_CRYPTO_BUFFER,
    resourceIdPath: 'params.cryptoId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Patch crypto metadata and buffer tiers' })
  @ApiParam({ name: 'cryptoId', description: 'ID of the cryptocurrency' })
  @ApiBody({ type: PatchCryptoDto })
  @ApiResponse({
    status: 200,
    description: 'Cryptocurrency updated successfully',
  })
  async patchCrypto(
    @Param('cryptoId') cryptoId: string,
    @Body() dto: PatchCryptoDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cryptoBufferService.patchCrypto(cryptoId, dto);
  }

  @Patch('bulk')
  @AuditLog({
    action: AuditAction.ADMIN_BULK_PATCH_CRYPTO,
    resource: AuditResource.ADMIN_CRYPTO_BUFFER,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Bulk patch multiple cryptocurrencies' })
  @ApiBody({ type: BulkPatchCryptoDto })
  @ApiResponse({
    status: 200,
    description: 'Bulk patch processed successfully',
  })
  async bulkPatch(
    @Body() dto: BulkPatchCryptoDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cryptoBufferService.bulkPatchCryptos(dto);
  }

  @Delete(':cryptoId/buffer-tiers/:tierId')
  @AuditLog({
    action: AuditAction.ADMIN_DELETE_BUFFER_TIER,
    resource: AuditResource.ADMIN_CRYPTO_BUFFER,
    resourceIdPath: 'params.tierId',
  })
  @ApiOperation({
    summary: '[ADMIN] Delete a buffer tier for a cryptocurrency',
  })
  @ApiParam({ name: 'cryptoId', description: 'ID of the cryptocurrency' })
  @ApiParam({ name: 'tierId', description: 'ID of the buffer tier to delete' })
  @ApiResponse({ status: 200, description: 'Buffer tier deleted successfully' })
  async deleteBufferTier(
    @Param('cryptoId') cryptoId: string,
    @Param('tierId') tierId: string,
  ) {
    return this.cryptoBufferService.deleteBufferTier(cryptoId, tierId);
  }
}
