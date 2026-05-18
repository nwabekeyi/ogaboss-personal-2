import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyPinForQuoteDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;

  @IsString()
  @IsNotEmpty()
  pin: string;
}