// src/modules/user/user.module.ts
import { Module } from '@nestjs/common';
import { UserService } from './service/user.service';
import { UserController } from './controllers/user.controller';
import { NotificationService } from './service/notification.service';
import { NotificationController } from './controllers/notification.controller';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { JwtModule } from '@nestjs/jwt';
@Module({
  imports: [JwtModule],
  controllers: [UserController, NotificationController],
  providers: [UserService, NotificationService, PrismaService],
  exports: [UserService, NotificationService],
})
export class UserModule {}
