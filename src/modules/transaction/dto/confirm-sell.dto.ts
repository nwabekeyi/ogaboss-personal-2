// src/modules/transaction/dto/confirm-sell.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmSellDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;
}