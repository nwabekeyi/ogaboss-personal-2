import { Module } from '@nestjs/common';
import { AutoStackController } from './controllers/autostack.controller';
import { AutoStackService } from './services/autostack.service';

@Module({ controllers: [AutoStackController], providers: [AutoStackService], exports: [AutoStackService] })
export class AutoStackModule {}
