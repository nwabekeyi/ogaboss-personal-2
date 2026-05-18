import { OrderStatus } from '../../../infrastructure';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString } from 'class-validator';
import { BaseQueryParam } from '../../../common';

export class OrderQueryParamDTO extends BaseQueryParam {
  @ApiPropertyOptional({
    description: 'A search term to filter bundles',
    example: '',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter orders by status',
    enum: OrderStatus,
    example: '',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description: 'Filter orders  by currency ID',
    example: 'cm4u05p9t0000m79afusk8y5g',
  })
  @IsOptional()
  @IsString()
  currencyId?: string;
}

export class HaveOrderedBeforeDTO {
  @ApiPropertyOptional({
    description: 'User email',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: 'User phone number',
    example: '+2341234567890',
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
