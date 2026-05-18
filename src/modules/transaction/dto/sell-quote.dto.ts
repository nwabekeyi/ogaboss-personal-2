import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SellQuoteDto {
  @ApiProperty({
    description: 'Crypto symbol to sell',
    example: 'BTC',
  })
  @IsString()
  @IsNotEmpty()
  crypto: string;

  @ApiProperty({
    description: 'Amount of crypto to sell (must be > 0)',
    example: 0.05,
    minimum: 0.00000001,
  })
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiPropertyOptional({
    description: 'Blockchain network (e.g., ERC20, TRC20, BSC)',
    example: 'bep20',
  })
  @IsString()
  @IsNotEmpty()
  network?: string;
}