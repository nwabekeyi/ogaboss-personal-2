import { Body, Get, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../common';
import { AuthGuard, HttpExceptionInterceptor } from '../../core';
import { VersionedController } from '../../core/decorators';
import { BillsService } from './bills.service';
import { BillPaymentConfirmDto, BillQuoteDto, ValidateBillDto } from './dto/bills.dto';

@ApiTags('Bills')
@ApiBearerAuth('Bearer')
@VersionedController('bills')
@UseGuards(AuthGuard)
@UseInterceptors(HttpExceptionInterceptor)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get('categories') categories() { return this.billsService.categories(); }
  @Get('billers') billers(@Query('categoryId') categoryId: string) { return this.billsService.billers(categoryId); }
  @Post('validate') validate(@Body() dto: ValidateBillDto) { return this.billsService.validate(dto); }
  @Post('quote') quote(@Req() req: AuthenticatedRequest, @Body() dto: BillQuoteDto) { return this.billsService.quote(req.user.id, dto); }
  @Post('confirm') confirm(@Req() req: AuthenticatedRequest, @Body() dto: BillPaymentConfirmDto) { return this.billsService.confirm(req.user.id, dto); }
}
