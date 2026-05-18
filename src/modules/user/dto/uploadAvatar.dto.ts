// src/modules/user/dto/upload-avatar.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UploadAvatarDto {
  @ApiProperty({
    type: 'string',
    description: 'Base64 encoded image (e.g. data:image/png;base64,...)',
    example:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  })
  @IsString()
  image: string;
}