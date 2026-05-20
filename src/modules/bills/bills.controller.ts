import { Body, Get, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../common';
import { AuthGuard, HttpExceptionInterceptor } from '../../core';
import { VersionedController } from '../../core/decorators';
import { BillsService } from './bills.service';
import { PayBillDto, ValidateBillDto } from './dto/bills.dto';

@ApiTags('Bills')
@ApiBearerAuth('Bearer')
@VersionedController('bills')
@UseGuards(AuthGuard)
@UseInterceptors(HttpExceptionInterceptor)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get('categories')
  categories() {
    return this.billsService.categories();
  }

  @Get('billers')
  billers(@Query('category') category: string) {
    return this.billsService.billers(category);
  }

  @Post('validate')
  validate(@Body() dto: ValidateBillDto) {
    return this.billsService.validate(dto);
  }

  @Post('pay')
  pay(@Req() req: AuthenticatedRequest, @Body() dto: PayBillDto) {
    return this.billsService.pay(req.user.id, dto);
  }
}
