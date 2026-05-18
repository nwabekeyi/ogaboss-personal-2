import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class confirmTransactionDTO {
    @ApiProperty({
        example: 'TWMjBKD61DLXXQr6AvVnDMcVs5p46QSFzT',
        description: 'The receiver wallet address',
    })
    @IsString()
    @IsNotEmpty()
    receiverWalletAddress: string;

    @ApiProperty({
        example: 'TWMjBKD61DLXXQr6AvVnDMcVs5p46QSFzT',
        description: 'The sender wallet address',
    })
    @IsString()
    @IsNotEmpty()
    senderWalletAddress: string;

    @ApiProperty({
        example: 'TWMjBKD61DLXXQr6AvVnDMcVs5p46QSFzT',
        description: 'The sender wallet address',
    })
    @IsString()
    @IsNotEmpty()
    platformWalletAddress: string;

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
        example: "The type of transaction",
        description: 'The transaction type',
    })
    @IsString()
    @IsNotEmpty()
    transactionType: string;

    @ApiProperty({
        example: "Stay safe, I'm sending the coin now",
        description: 'The narration node',
    })
    @IsString()
    @IsOptional()
    narrationNote: string;




}











// import { TokenSet } from '@coincord/coincord-core-sdk-wallet';
// import { IsNumber, IsOptional, IsString } from 'class-validator';
// import {
//   CurrentTokenCollection,
//   EventCategory,
// } from 'src/modules/coincord/types';

// export class CreateTransactionDto {
//   @IsString()
//   address: string;

//   @IsString()
//   tokenSet: TokenSet;

//   @IsString()
//   @IsOptional()
//   reference: string;

//   @IsString()
//   @IsOptional()
//   recipient: string;

//   @IsString()
//   tokenName: CurrentTokenCollection;

//   @IsString()
//   event: EventCategory;

//   @IsString()
//   txHash: string;

//   @IsNumber()
//   amount: number;

//   @IsNumber()
//   @IsOptional()
//   fee: number;

//   @IsString()
//   details: string;

//   @IsString()
//   coincordEventId: string;

//   @IsString()
//   coincordTransactionId: string;

//   @IsString()
//   user: string;
// }
