import { IsOptional, IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateBufferTierDto } from './update-buffer-tier.dto';

export class PatchBufferTierDto extends UpdateBufferTierDto {
  @IsString()
  id: string;
}

export class PatchCryptoDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  defaultBufferPercent?: number;

  @IsOptional()
  @IsNumber()
  maxBufferPercent?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PatchBufferTierDto)
  tiers?: PatchBufferTierDto[];
}
