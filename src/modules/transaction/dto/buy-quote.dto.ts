import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BuyQuoteDto {
  @ApiProperty({
    description: 'Crypto symbol (e.g., BTC, ETH, USDT)',
    example: 'BTC',
  })
  @IsString()
  @IsNotEmpty()
  crypto: string;

  @ApiProperty({
    description: 'Amount of crypto to buy',
    example: 0.01,
  })
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiPropertyOptional({
    description: 'Blockchain network (e.g., ERC20, TRC20, BSC)',
    example: 'btc',
  })
  @IsString()
  @IsNotEmpty()
  network?: string;
}
