import {
    IsOptional,
    IsEnum,
    IsInt,
    Min,
    Max,
    IsString,
    IsDateString,
  } from 'class-validator';
  import { Transform } from 'class-transformer';
  import { ApiProperty } from '@nestjs/swagger';
  import {
    TransactionStatus,
    TransactionType,
    TransactionContext,
  } from '../../../infrastructure';

  export class GetTransactionsDto {
    @ApiProperty({
      description: 'Page number for pagination (starts at 1)',
      example: 1,
      minimum: 1,
      default: 1,
      required: false,
    })
    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiProperty({
      description: 'Number of transactions to return per page (max 100)',
      example: 20,
      minimum: 1,
      maximum: 100,
      default: 20,
      required: false,
    })
    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @ApiProperty({
      description: 'Filter by status',
      enum: TransactionStatus,
      required: false,
    })
    @IsOptional()
    @IsEnum(TransactionStatus)
    status?: TransactionStatus;

    @ApiProperty({
      description: 'Filter by type',
      enum: TransactionType,
      required: false,
    })
    @IsOptional()
    @IsEnum(TransactionType)
    type?: TransactionType;

    @ApiProperty({
      description: 'Filter by context',
      enum: TransactionContext,
      required: false,
    })
    @IsOptional()
    @IsEnum(TransactionContext)
    context?: TransactionContext;

    @ApiProperty({
      description: 'Filter by currency',
      example: 'USDT',
      required: false,
    })
    @IsOptional()
    @IsString()
    currency?: string;

    @ApiProperty({
      description: 'Filter by user ID (admin only)',
      example: 'user_123',
      required: false,
    })
    @IsOptional()
    @IsString()
    userId?: string;

    @ApiProperty({
      description: 'Start date (ISO format)',
      example: '2025-12-01',
      required: false,
    })
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @ApiProperty({
      description: 'End date (ISO format)',
      example: '2025-12-16',
      required: false,
    })
    @IsOptional()
    @IsDateString()
    endDate?: string;
  }