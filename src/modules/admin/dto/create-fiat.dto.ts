import { IsString, IsOptional } from 'class-validator';

export class CreateFiatDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  symbol?: string;
}
