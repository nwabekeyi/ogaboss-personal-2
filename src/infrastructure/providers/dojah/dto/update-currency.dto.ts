import { IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class UpdateCurrencyDto {
  @IsNumber()
  @IsOptional()
  buyRate?: number;

  @IsNumber()
  @IsOptional()
  sellRate?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
