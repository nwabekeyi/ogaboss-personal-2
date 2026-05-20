import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { XpresspayService } from './xpresspay.service';

@Module({
  imports: [HttpModule],
  providers: [XpresspayService],
  exports: [XpresspayService],
})
export class XpresspayModule {}
