import { Body, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, VersionedController } from '../../../core';
import { apiTags } from '../../../shared';
import { AutoStackService } from '../services/autostack.service';
import { AutoStackConfirmDto, AutoStackPaymentTypesDto, AutoStackPreviewDto, AutoStackQuoteDto, EndAutoStackDto } from '../dto/autostack.dto';

@ApiTags('autostack')
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.vault + '-autostack')
export class AutoStackController {
  constructor(private readonly service: AutoStackService) {}

  @Post('quote')
  @ApiOperation({ summary: 'Create auto stack quote' })
  quote(@Request() req: any, @Body() dto: AutoStackQuoteDto) { return this.service.quote(req.user.id, dto); }

  @Post('payment-types')
  @ApiOperation({ summary: 'Get payment types for quote' })
  paymentTypes(@Request() req: any, @Body() dto: AutoStackPaymentTypesDto) { return this.service.paymentTypes(req.user.id, dto); }

  @Post('preview')
  @ApiOperation({ summary: 'Preview auto stack using quote' })
  preview(@Request() req: any, @Body() dto: AutoStackPreviewDto) { return this.service.preview(req.user.id, dto); }

  @Post('create')
  @ApiOperation({ summary: 'Create auto stack' })
  create(@Request() req: any, @Body() dto: AutoStackConfirmDto) { return this.service.confirm(req.user.id, dto); }

  @Get('history')
  history(@Request() req: any, @Query('page') page = '1', @Query('limit') limit = '20') { return this.service.getHistory(req.user.id, Number(page), Number(limit)); }

  @Get('overview')
  overview(@Request() req: any) { return this.service.overview(req.user.id); }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel pending autostack (before first execution)' })
  cancel(@Request() req: any, @Body() dto: EndAutoStackDto) { return this.service.cancelPending(req.user.id, dto.autoStackId); }

  @Post('unlock')
  @ApiOperation({ summary: 'Unlock/end autostack with penalty if before due date' })
  unlock(@Request() req: any, @Body() dto: EndAutoStackDto) { return this.service.unlock(req.user.id, dto); }
}
