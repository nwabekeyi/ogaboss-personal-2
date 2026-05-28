import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VaultService } from '../services/vault.service';
import {
  VaultQuoteDto,
  VaultPreviewDto,
  VaultConfirmDto,
  UnlockVaultDto,
  CancelVaultDto,
} from '../dto/vault.dto';
import { AuthGuard, VersionedController } from '../../../core';
import { apiTags } from '../../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags(apiTags.vault)
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.vault)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Post('quote')
  @AuditLog({ action: AuditAction.VAULT_QUOTE, resource: AuditResource.VAULT })
  @ApiOperation({ summary: 'Get vault quote' })
  getQuote(@Request() req: any, @Body() dto: VaultQuoteDto) {
    return this.vaultService.getVaultQuote(req.user.id, dto);
  }

  @Post('preview')
  @AuditLog({ action: AuditAction.VAULT_PREVIEW, resource: AuditResource.VAULT })
  @ApiOperation({ summary: 'Get vault preview' })
  getPreview(@Request() req: any, @Body() dto: VaultPreviewDto) {
    return this.vaultService.getVaultPreview(req.user.id, dto);
  }

  @Post('create')
  @AuditLog({ action: AuditAction.VAULT_CREATE, resource: AuditResource.VAULT })
  @ApiOperation({ summary: 'Create vault' })
  createVault(@Request() req: any, @Body() dto: VaultConfirmDto) {
    return this.vaultService.confirmVault(req.user.id, dto.quoteId);
  }

  @Post('unlock')
  @AuditLog({ action: AuditAction.VAULT_UNLOCK, resource: AuditResource.VAULT })
  @ApiOperation({ summary: 'Unlock funds from vault' })
  unlock(@Request() req: any, @Body() dto: UnlockVaultDto) {
    return this.vaultService.unlock(req.user.id, dto);
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel a pending vault' })
  cancel(@Request() req: any, @Body() dto: CancelVaultDto) {
    return this.vaultService.cancelPendingVault(req.user.id, dto.vaultId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all user vaults' })
  getVaults(@Request() req: any, @Query('page') page = '1', @Query('limit') limit = '10') {
    return this.vaultService.getUserVaults(req.user.id, Number(page), Number(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific vault' })
  getVault(@Request() req: any, @Param('id') id: string) {
    return this.vaultService.getVaultById(req.user.id, id);
  }
}
