// src/modules/transaction/dto/confirm-send.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmSendDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;
}