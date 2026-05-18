import { Global, Module } from '@nestjs/common';
import {
  PaginationService,
  TokenService,
  OtpService,
  TempStoreService,
} from './services';
import { JwtService } from '@nestjs/jwt';

@Global()
@Module({
  providers: [
    TokenService,
    PaginationService,
    JwtService,
    TempStoreService,
    OtpService,
    // ProxyManagerService,
  ],
  exports: [
    TokenService,
    PaginationService,
    TempStoreService,
    OtpService,
    // ProxyManagerService,
  ],
})
export class SharedModule {}
