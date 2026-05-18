// src/modules/account/dto/create-bank-with-token.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateBankWithTokenDto {
  @IsString()
  @IsNotEmpty()
  tempToken: string;
}