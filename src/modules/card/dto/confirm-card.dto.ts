import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmCardDto {
  @ApiProperty({
    description: 'The unique reference of the card transaction to confirm',
    example: 'card-12345-1678901234567',
  })
  @IsString()
  @IsNotEmpty()
  reference: string;
}
