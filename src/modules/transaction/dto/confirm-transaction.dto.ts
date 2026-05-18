import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmTransactionDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;

  @IsString()
  @IsNotEmpty()
  pin: string;
}