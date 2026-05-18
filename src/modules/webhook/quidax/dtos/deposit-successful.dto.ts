import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

/* ---------------- USER ---------------- */
export class DepositUserDto {
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

export class WalletNetworkDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsBoolean()
  deposits_enabled: boolean;

  @IsBoolean()
  withdraws_enabled: boolean;
}

export class DepositWalletDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  currency: string;

  @IsString()
  balance: string;

  @IsString()
  locked: string;

  @IsString()
  staked: string;

  @ValidateNested()
  @Type(() => DepositUserDto)
  user: DepositUserDto;

  @IsString()
  converted_balance: string;

  @IsString()
  reference_currency: string;

  @IsBoolean()
  is_crypto: boolean;

  @IsString()
  default_network: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WalletNetworkDto)
  networks: WalletNetworkDto[];

  @IsString()
  deposit_address: string;

  @IsOptional()
  @IsString()
  destination_tag?: string | null;

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsString()
  updated_at?: string;
}

export class PaymentTransactionDto {
  @IsString()
  status: string;

  @IsNumber()
  confirmations: number;

  @IsNumber()
  required_confirmations: number;
}

/* ---------------- PAYMENT ADDRESS ---------------- */
export class PaymentAddressDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsString()
  currency: string;

  @IsString()
  address: string;

  @IsString()
  network: string;

  @ValidateNested()
  @Type(() => DepositUserDto)
  user: DepositUserDto;

  @IsOptional()
  @IsString()
  destination_tag?: string | null;

  @IsOptional()
  total_payments?: number | null;

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsString()
  updated_at?: string;
}

export class DepositSuccessfulDataDto {
  @IsString()
  id: string;

  @IsString()
  type: string;

  @IsString()
  currency: string;

  @IsString()
  amount: string;

  @IsString()
  fee: string;

  @IsOptional()
  @IsString()
  txid?: string | null;

  @IsString()
  status: string;

  @IsOptional()
  reason?: string | null;

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsString()
  done_at?: string | null;

  @ValidateNested()
  @Type(() => DepositWalletDto)
  wallet: DepositWalletDto;

  @ValidateNested()
  @Type(() => DepositUserDto)
  user: DepositUserDto;

  @IsOptional()
  @IsString()
  sender?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentTransactionDto)
  payment_transaction?: PaymentTransactionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentAddressDto)
  payment_address?: PaymentAddressDto;
}
