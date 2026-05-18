import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPinDTO {
    @ApiProperty({
        example: 'john@example.com',
        description: 'The email of the user requesting to reset their PIN',
    })
    @IsEmail()
    @IsNotEmpty()
    email: string;
}
