import { IsNumber, IsOptional, Max } from 'class-validator';

export class UpdateCurrencyDto {
  @IsNumber()
  @IsOptional()
  @Max(100, { message: 'buyRate cannot exceed 100' })
  buyRate?: number;

  @IsNumber()
  @IsOptional()
  @Max(100, { message: 'sellRate cannot exceed 100' })
  sellRate?: number;
}
