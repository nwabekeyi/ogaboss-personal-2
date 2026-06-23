import { Module } from '@nestjs/common';
import { UrgentLiquidityController } from './controllers/urgent-liquidity.controller';
import { UrgentLiquidityService } from './services/urgent-liquidity.service';
import { PrismaModule } from '../../infrastructure/databases/prisma';
import { RedisModule } from '../../infrastructure/databases/redis';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [PrismaModule, RedisModule, QuidaxModule],
  controllers: [UrgentLiquidityController],
  providers: [UrgentLiquidityService, JwtService],
  exports: [UrgentLiquidityService],
})
export class UrgentLiquidityModule {}
