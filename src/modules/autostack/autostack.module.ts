import { Module } from '@nestjs/common';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { AutoStackController } from './controllers/autostack.controller';
import { AutoStackService } from './services/autostack.service';

@Module({
  imports: [QuidaxModule],
  controllers: [AutoStackController],
  providers: [AutoStackService],
  exports: [AutoStackService],
})
export class AutoStackModule {}
