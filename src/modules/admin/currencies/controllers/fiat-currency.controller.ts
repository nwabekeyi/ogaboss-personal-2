import {
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiQuery,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';

import { AuthGuard, AdminRolesGuard } from '../../../../common';
import { VersionedController } from '../../../../core/decorators';
import { AuthenticatedRequest } from '../../../../common/types';
import { FiatCurrencyService } from '../services/fiat-currency.service';
import { CreateFiatDto, PatchFiatDto } from '../../dto';
import { apiTags } from '../../../../shared';
import { RequirePermissions } from '../../../../core/decorators';
import { Permission } from '../../../../infrastructure';

@ApiTags('Admin - Fiat Currency Management')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.fiat)
export class FiatCurrencyController {
  constructor(private readonly fiatService: FiatCurrencyService) {}


  @Get('options')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get all fiat options for frontend selection' })
  @ApiQuery({ name: 'search', required: false, description: 'Optional search by code or name' })
  @ApiResponse({
    status: 200,
    description: 'Fiat options retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          { code: 'USD', name: 'US Dollar', decimals: 2, countries: ['United States'] },
          { code: 'EUR', name: 'Euro', decimals: 2, countries: ['Germany', 'France'] },
        ],
      },
    },
  })
  async getAllFiatOptions(@Query('search') search?: string) {
    return this.fiatService.getAllFiatOptions(search);
  }


  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get all stored fiat currencies' })
  @ApiQuery({ name: 'search', required: false, description: 'Optional search by code or name' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number', type: Number })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Number of items per page', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Fiat currencies retrieved successfully',
  })
  async getAllFiats(
    @Query('search') search?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ) {
    return this.fiatService.getAllFiats({
      search,
      page,
      pageSize,
    });
  }

  @Post()
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Create a new fiat currency' })
  @ApiBody({ type: CreateFiatDto })
  @ApiResponse({
    status: 201,
    description: 'Fiat currency created successfully',
  })
  async createFiat(@Body() dto: CreateFiatDto, @Req() req: AuthenticatedRequest) {
    return this.fiatService.createFiat(dto);
  }


  @Patch(':fiatId')
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Patch fiat currency by ID' })
  @ApiParam({ name: 'fiatId', description: 'Fiat ID to update' })
  @ApiBody({ type: PatchFiatDto })
  @ApiResponse({
    status: 200,
    description: 'Fiat currency updated successfully',
  })
  async patchFiat(
    @Param('fiatId') fiatId: string,
    @Body() dto: PatchFiatDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.fiatService.patchFiat(fiatId, dto);
  }
}
