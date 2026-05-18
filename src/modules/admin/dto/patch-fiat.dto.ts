import { IsString, IsOptional } from 'class-validator';

export class PatchFiatDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  symbol?: string;
}
