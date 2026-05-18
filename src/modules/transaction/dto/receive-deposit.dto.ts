// src/modules/transaction/dto/deposit-address.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class DepositAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'Currency is required' })
  currency: string;

  @IsString()
  @IsNotEmpty()
  network?: string;
}