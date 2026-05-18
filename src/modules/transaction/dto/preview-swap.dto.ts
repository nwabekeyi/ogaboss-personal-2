import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class PreviewSwapDto {
  @ApiProperty({
    description: 'Swap quote ID returned from /swap/quote',
    example: 'swap_quote_123',
  })
  @IsString()
  quoteId: string;
}
