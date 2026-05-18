// src/modules/user/dto/upload-avatar-file.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class UploadAvatarFileDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Image file (png, jpg, jpeg, webp, gif, etc.)',
  })
  file: any;   // Swagger only cares about the decorator
}