import { IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateBufferTierDto {
  @IsOptional()
  minAmount?: string;

  @IsOptional()
  maxAmount?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bufferPercent?: number;
}
