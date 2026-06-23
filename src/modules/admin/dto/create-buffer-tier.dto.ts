import { IsOptional, IsNumber, Min, Max, IsEnum, IsString } from 'class-validator';
import { OrderType } from '../../../infrastructure';

export class CreateBufferTierDto {
  @IsOptional()
  @IsEnum(OrderType, { message: 'orderType must be either BUY or SELL' })
  orderType?: OrderType;

  @IsString({ message: 'minAmount must be a string representing a decimal' })
  minAmount: string;

  @IsString({ message: 'maxAmount must be a string representing a decimal' })
  maxAmount: string;

  @IsNumber({}, { message: 'bufferPercent must be a number' })
  @Min(0, { message: 'bufferPercent must be at least 0' })
  @Max(100, { message: 'bufferPercent cannot exceed 100' })
  bufferPercent: number;
}