import { IsString, IsOptional, IsBoolean, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

// ── Shared / Common ──
export class WithdrawalUserDto {
  @IsString()
  id: string;

  @IsString()
  sn: string;

  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsOptional()
  @IsString()
  display_name?: string | null;

  @IsString()
  created_at: string;

  @IsString()
  updated_at: string;
}

export class WithdrawalWalletDto {
  @IsString()
  id: string;

  @IsString()
  currency: string;

  @IsString()
  balance: string;

  @IsString()
  locked: string;

  @IsString()
  staked: string;

  @IsString()
  converted_balance: string;

  @IsString()
  reference_currency: string;

  @IsBoolean()
  is_crypto: boolean;

  @IsString()
  created_at: string;

  @IsString()
  updated_at: string;

  @IsOptional()
  @IsString()
  deposit_address?: string;

  @IsOptional()
  @IsString()
  destination_tag?: string | null;
}

// ── Recipient Details (for external withdrawals) ──
export class RecipientDetailsDto {
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  destination_tag?: string | null;

  @IsOptional()
  @IsString()
  name?: string | null;
}

// ── Recipient (internal or external) ──
export class WithdrawalRecipientDto {
  @IsString()
  type: string; // "internal" | "coin_address"

  @IsObject()
  details: RecipientDetailsDto | { user_id: string }; // union based on type
}

// ── Main Payload DTO (used for both successful & rejected) ──
export class WithdrawalWebhookDataDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsString()
  type: string; // "internal" | "coin_address"

  @IsString()
  currency: string;

  @IsString()
  amount: string;

  @IsString()
  fee: string;

  @IsString()
  total: string;

  @IsOptional()
  @IsString()
  txid?: string | null;

  @IsString()
  transaction_note: string;

  @IsString()
  narration: string;

  @IsString()
  status: string; // "Done" | "Rejected"

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsString()
  created_at: string;

  @IsOptional()
  @IsString()
  done_at?: string | null;

  @ValidateNested()
  @Type(() => WithdrawalRecipientDto)
  recipient: WithdrawalRecipientDto;

  @ValidateNested()
  @Type(() => WithdrawalWalletDto)
  wallet: WithdrawalWalletDto;

  @ValidateNested()
  @Type(() => WithdrawalUserDto)
  user: WithdrawalUserDto;
}

// ── Top-level event wrapper (if your webhook sends "event" + "data")
export class WithdrawalWebhookDto {
  @IsString()
  event: 'withdraw.successful' | 'withdraw.rejected';

  @ValidateNested()
  @Type(() => WithdrawalWebhookDataDto)
  data: WithdrawalWebhookDataDto;
}