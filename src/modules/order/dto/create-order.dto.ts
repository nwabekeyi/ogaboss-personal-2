import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { OrderType } from '../../../infrastructure';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full name of the customer',
  })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email of the customer',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '+2348011111111',
    description: 'Phone number of the customer',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({
    example: '70123456789',
    description:
      'National Identity Number (Required for Nigerian phone numbers)',
  })
  @IsString()
  @IsOptional()
  nin?: string;

  @ApiProperty({
    example: '0x1234567890abcdef',
    description: 'Wallet address of the customer',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({
    example: 0.00000001,
    description: 'Amount of crypto to buy',
  })
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  @Min(0.00000001)
  cryptoAmount: number;

  @ApiProperty({
    example: 100,
    description: 'Amount of fiat to buy',
  })
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  @Min(1)
  fiatAmount: number;

  @ApiProperty({
    example: 'cuidhajd36sandkfgsgd',
    description: 'ID of the currency',
  })
  @IsString()
  @IsNotEmpty()
  currencyId: string;

  @ApiProperty({
    example: 'USD',
    description: 'Fiat currency',
  })
  @IsString()
  @IsNotEmpty()
  fiatCurrency: string;

  @ApiProperty({
    example: 'BUY',
    description: 'Type of the order',
  })
  @IsEnum(OrderType)
  type: OrderType;
}
