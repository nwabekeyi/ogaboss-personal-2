// wallet-address-generated.dto.ts
import { IsString, IsOptional, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class WebhookUserDto {
  @IsString()
  id: string;

  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  sn?: string | null;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  display_name?: string | null;

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsString()
  updated_at?: string;
}

export class WalletAddressGeneratedDataDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsString()
  currency: string;

  @IsString()
  address: string;

  @IsOptional()
  @IsString()
  network?: string | null;

  @IsOptional()
  @IsString()
  destination_tag?: string | null;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  total_payments?: number | null;

  @ValidateNested()
  @Type(() => WebhookUserDto)
  user: WebhookUserDto;

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsString()
  updated_at?: string;
}
