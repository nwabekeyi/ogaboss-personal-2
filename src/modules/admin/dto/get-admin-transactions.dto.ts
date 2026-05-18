import {
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsString,
  IsDateString,
  IsArray,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  TransactionStatus,
  TransactionType,
  TransactionContext,
} from '../../../infrastructure';

export class GetAdminTransactionsDto {
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
    description: 'Filter by transaction status',
    enum: TransactionStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({
    description: 'Filter by transaction type',
    enum: TransactionType,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({
    description: 'Filter by transaction context',
    enum: TransactionContext,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionContext)
  context?: TransactionContext;

  @ApiProperty({
    description: 'Filter by cryptocurrency',
    example: 'USDT',
    required: false,
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({
    description:
      '[ADMIN] Search by transaction ID or unique reference (e.g., BUY_abc123 or DEP_XXXX)',
    example: 'BUY_abc123',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: '[ADMIN] Filter by specific user ID (optional)',
    example: 'user_abc123',
    required: false,
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({
    description: 'Start date (inclusive)',
    example: '2025-12-01',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'End date (inclusive)',
    example: '2025-12-16',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class GetTransactionHistoryDto extends OmitType(
  GetAdminTransactionsDto,
  ['userId', 'search'] as const,
) {}

export class DownloadUserTransactionHistoryDto {
  @ApiProperty({
    description: 'User ID to download transaction history for',
    example: 'user_abc123',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'Start date (optional)',
    example: '2025-12-01',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'End date (optional)',
    example: '2025-12-31',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    description: 'Filter by transaction status (optional)',
    enum: TransactionStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({
    description: 'Filter by transaction type (optional)',
    enum: TransactionType,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({
    description: 'Filter by cryptocurrency (optional)',
    example: 'USDT',
    required: false,
  })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class DownloadUsersTransactionHistoryDto {
  @ApiProperty({
    description: 'Array of user IDs to download transaction history for',
    type: [String],
    example: ['user_abc123', 'user_def456'],
  })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @ApiProperty({
    description: 'Start date (optional)',
    example: '2025-12-01',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'End date (optional)',
    example: '2025-12-31',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    description: 'Filter by transaction status (optional)',
    enum: TransactionStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({
    description: 'Filter by transaction type (optional)',
    enum: TransactionType,
    required: false,
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({
    description: 'Filter by cryptocurrency (optional)',
    example: 'USDT',
    required: false,
  })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class DownloadTransactionReceiptDto {
  @ApiProperty({
    description: 'Transaction ID to download receipt for',
    example: 'txn_abc123',
  })
  @IsString()
  transactionId: string;
}

export class DownloadMultipleTransactionReceiptsDto {
  @ApiProperty({
    description: 'Array of transaction IDs to download receipts for',
    type: [String],
    example: ['txn_abc123', 'txn_def456'],
  })
  @IsArray()
  @IsString({ each: true })
  transactionIds: string[];
}

export class DownloadTransactionsByIdsDto {
  @ApiProperty({
    description: 'Array of transaction IDs',
    type: [String],
    example: ['txn_abc123', 'txn_def456'],
  })
  @IsArray()
  @IsString({ each: true })
  transactionIds: string[];
}
