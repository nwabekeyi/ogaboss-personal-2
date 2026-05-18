import { IsNumberString, Length } from 'class-validator';

export class ValidateNinDto {
  @IsNumberString({}, { message: 'NIN must be a numeric string' })
  @Length(11, 11, { message: 'NIN must be exactly 11 digits' })
  nin: string;
}