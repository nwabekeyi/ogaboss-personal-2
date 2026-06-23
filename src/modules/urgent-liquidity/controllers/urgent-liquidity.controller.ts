import {
  Post,
  Get,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard, VersionedController } from '../../../core';
import { apiTags } from '../../../shared';
import { UrgentLiquidityService } from '../services/urgent-liquidity.service';
import {
  UrgentLiquidityConfirmDto,
  UrgentLiquidityPreviewDto,
  UrgentLiquidityQuoteDto,
} from '../dto/urgent-liquidity.dto';

@ApiTags('urgent-liquidity')
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.urgentLiquidityClient)
export class UrgentLiquidityController {
  constructor(private readonly service: UrgentLiquidityService) {}

  @Post('quote')
  @ApiOperation({ summary: 'Create urgent liquidity loan quote' })
  quote(@Request() req: any, @Body() dto: UrgentLiquidityQuoteDto) {
    return this.service.quote(req.user.id, dto);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Preview urgent liquidity loan before confirmation' })
  preview(@Request() req: any, @Body() dto: UrgentLiquidityPreviewDto) {
    return this.service.preview(req.user.id, dto);
  }

  @Post('create')
  @ApiOperation({ summary: 'Confirm and create urgent liquidity loan' })
  create(@Request() req: any, @Body() dto: UrgentLiquidityConfirmDto) {
    return this.service.confirm(req.user.id, dto);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get urgent liquidity overview stats' })
  overview(@Request() req: any) {
    return this.service.overview(req.user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get paginated urgent liquidity loan history' })
  history(
    @Request() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.service.getHistory(req.user.id, Number(page), Number(limit));
  }
}
