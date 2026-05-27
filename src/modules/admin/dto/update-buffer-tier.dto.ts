import { IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateBufferTierDto {
  @IsOptional()
  minAmount?: string;

  @IsOptional()
  maxAmount?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bufferPercent?: number;
}
