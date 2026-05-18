import { Module } from '@nestjs/common';
import { DojahService } from './dojah.service';

@Module({
  imports: [],
  providers: [DojahService],
  exports: [DojahService],
})
export class DojahModule {}
