// src/modules/transaction/dto/confirm-buy.dto.ts
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class ConfirmBuyDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;
}