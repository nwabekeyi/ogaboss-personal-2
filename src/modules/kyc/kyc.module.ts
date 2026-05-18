// src/modules/kyc/kyc.module.ts
import { Module } from '@nestjs/common';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { DojahService } from '../../infrastructure/providers/dojah/dojah.service';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [HttpModule, JwtModule],
  controllers: [KycController],
  providers: [KycService, PrismaService, DojahService],
  exports: [KycService],
})
export class KycModule {}