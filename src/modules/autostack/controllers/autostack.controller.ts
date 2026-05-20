import { Body, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, VersionedController } from '../../../core';
import { apiTags } from '../../../shared';
import { AutoStackService } from '../services/autostack.service';
import { AutoStackConfirmDto, AutoStackPreviewDto, EndAutoStackDto } from '../dto/autostack.dto';

@ApiTags('autostack')
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.vault + '-autostack')
export class AutoStackController {
  constructor(private readonly service: AutoStackService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Preview auto stack' })
  preview(@Request() req: any, @Body() dto: AutoStackPreviewDto) {
    return this.service.preview(req.user.id, dto);
  }

  @Post('create')
  @ApiOperation({ summary: 'Create auto stack' })
  create(@Request() req: any, @Body() dto: AutoStackConfirmDto) {
    return this.service.confirm(req.user.id, dto);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active auto stacks' })
  active(@Request() req: any) {
    return this.service.getActive(req.user.id);
  }

  @Post('end')
  @ApiOperation({ summary: 'End auto stack' })
  end(@Request() req: any, @Body() dto: EndAutoStackDto) {
    return this.service.end(req.user.id, dto.autoStackId);
  }
}
