import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PreviewTransactionDTO {
    @ApiProperty({
        example: 'TWMjBKD61DLXXQr6AvVnDMcVs5p46QSFzT',
        description: 'The receiver wallet address',
    })
    @IsString()
    @IsNotEmpty()
    receiverWalletAddress: string;

    @ApiProperty({
        example: '0.004',
        description: 'The amount to send',
    })
    @IsNumber()
    @IsNotEmpty()
    amount: number;

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
        example: "The description of the transaction note",
        description: 'The description node',
    })
    @IsString()
    @IsOptional()
    description: string;

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
