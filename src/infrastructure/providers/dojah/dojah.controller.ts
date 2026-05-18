import { UseInterceptors } from '@nestjs/common';
import { DojahService } from './dojah.service';
import { HttpExceptionInterceptor } from '../../../core';

@UseInterceptors(HttpExceptionInterceptor)
export class DojahController {
  constructor(private readonly dojahService: DojahService) {}
}
