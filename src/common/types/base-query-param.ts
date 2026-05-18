import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DateRange } from '../helpers';
import { SortOrder } from '../enums';

export class BaseQueryParam {
  @ApiProperty({
    description: 'The page number to retrieve',
    example: 1,
  })
  @Type(() => Number)
  @IsPositive()
  @IsNotEmpty()
  page: number;

  @ApiProperty({
    description: 'The number of items per page',
    example: 10,
  })
  @Type(() => Number)
  @IsPositive()
  @IsNotEmpty()
  pageSize: number;

  @ApiPropertyOptional({
    description: 'The date range to filter orders',
    example: '7days',
  })
  @IsOptional()
  @IsString()
  dateRange?: DateRange;

  @ApiPropertyOptional({
    description: 'The start date to filter orders',
    example: '2024-12-10T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'The end date to filter orders',
    example: '2024-12-22T23:59:59.000Z',
  })
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({
    description: 'The order to filter orders',
    example: 'asc',
  })
  @IsOptional()
  @IsString()
  @IsEnum(SortOrder)
  orderBy?: SortOrder;
}
