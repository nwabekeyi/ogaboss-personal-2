import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class SendCoinDTO {
    @ApiProperty({
        example: 'TWMjBKD61DLXXQr6AvVnDMcVs5p46QSFzT',
        description: 'The wallet address to send coins to',
    })
    @IsString()
    @IsNotEmpty()
    fundWallet: string;

    @ApiProperty({
        example: '0.004',
        description: 'The amount to send',
    })
    @IsString()
    @IsNotEmpty()
    amount: string;

    @ApiProperty({
        example: 'btc,usdt,ngn',
        description: 'The coin to send to the reciever',
    })
    @IsString()
    @IsNotEmpty()
    currency: string;

    @ApiProperty({
        example: 'trc20,erc20, bep20',
        description: 'The coin network',
    })
    @IsString()
    @IsNotEmpty()
    network: string;

    @ApiProperty({
        example: "Stay safe, I'm sending the coin now",
        description: 'The transaction note',
    })
    @IsString()
    @IsOptional()
    transactionNote: string;

    @ApiProperty({
        example: "Stay safe, I'm sending the coin now",
        description: 'The narration node',
    })
    @IsString()
    @IsOptional()
    narrationNote: string;






}
