import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class updateBankAccountDTO {

  @ApiProperty({
    example: 'Akindele Simeon',
    description: 'Full name on the bank account',
  })
  @IsString()
  @IsNotEmpty()
  bankAccountName: string;

  @ApiProperty({
    example: '9034567384',
    description: 'The 10-digit account number',
  })
  @IsString()
  @IsOptional()
  bankAccountNumber: string;

  @ApiProperty({
    example: 'Access Bank',
    description: 'The name of the bank',
  })
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @ApiProperty({
    example: '044',
    description: 'The NIP bank code',
  })
  @IsString()
  @IsNotEmpty()
  bankCode: string;
}
