import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateCurrencyDto {
  @ApiProperty({
    example: 'Bitcoin',
    description: 'Name of the cryptocurrency',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'BTC', description: 'Symbol of the cryptocurrency' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({
    example: 25000.5,
    description: 'Rate when customers buy crypto',
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.00000001)
  @Transform(({ value }) => parseFloat(value))
  buyRate: number;

  @ApiProperty({
    example: 24800.5,
    description: 'Rate when customers sell crypto',
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.00000001)
  @Transform(({ value }) => parseFloat(value))
  sellRate: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the currency is active',
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  isActive?: boolean = true;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  image?: Express.Multer.File;
}
