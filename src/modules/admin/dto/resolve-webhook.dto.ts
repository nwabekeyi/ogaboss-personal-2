import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveWebhookDto {
  @ApiProperty({
    description: 'Comment explaining how the failed webhook was resolved',
    example:
      'Manually re-triggered the Quidax order and confirmed payout completed.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, {
    message:
      'Resolution comment must be at least 10 characters for audit purposes',
  })
  resolutionComment: string;
}
