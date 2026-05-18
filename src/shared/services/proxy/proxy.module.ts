import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyManagerService } from './proxy-manager.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [ProxyController],
  providers: [ProxyManagerService],
  exports: [ProxyManagerService],
})
export class ProxyModule {}
