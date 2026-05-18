// // src/modules/order/order.module.ts
// import { Module } from '@nestjs/common';
// import { OrderService } from './order.service';
// import { OrderController } from './order.controller';
// import { AuthModule } from '../auth/auth.module';
// import { DojahService } from '../../infrastructure/providers/dojah/dojah.service';
// import { PaystackService } from '../../infrastructure/providers/paystack/paystack.service';
// import { QuidaxWalletService } from '../../infrastructure/providers/quidax';
// import { ProxyModule } from '../../shared/services/proxy/proxy.module';

// @Module({
//   imports: [AuthModule, ProxyModule],
//   controllers: [OrderController],
//   providers: [
//     OrderService,
//     DojahService,
//     PaystackService,
//     QuidaxWalletService, // ← Use modular wallet service
//   ],
// })
// export class OrderModule {}