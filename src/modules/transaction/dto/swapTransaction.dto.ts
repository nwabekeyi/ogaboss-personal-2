import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSwapDto {
    @ApiProperty({
        example: 'btc',
        description: 'The currency to swap from',
    })
    @IsString()
    @IsNotEmpty()
    fromCurrency: string;

    @ApiProperty({
        example: 'usdt',
        description: 'The currency to swap to',
    })
    @IsString()
    @IsNotEmpty()
    toCurrency: string;

    @ApiProperty({
        example: '0.004',
        description: 'The amount to swap',
    })
    @IsNumber()
    @IsNotEmpty()
    amount: number;

    @ApiProperty({
        example: 'trc20',
        description: 'The network to swap to',
    })
    @IsOptional()
    @IsString()
    description?: string;
}