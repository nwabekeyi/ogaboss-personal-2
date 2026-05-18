import { IsEnum, IsString, IsOptional } from 'class-validator';
import { PaymentType } from '../../../infrastructure';

export class PreviewBuyDto {
  @IsString()
  quoteId: string;

  @IsString()
  paymentMethodId: string;

  @IsOptional()
  @IsString()
  cardId?: string;
}