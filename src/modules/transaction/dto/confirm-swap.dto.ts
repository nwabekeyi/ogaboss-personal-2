// src/modules/transaction/dto/confirm-swap.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmSwapDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;
}