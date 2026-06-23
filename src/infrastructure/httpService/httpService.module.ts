import { Global, Module } from '@nestjs/common';
import { HttpModule as NestHttpModule } from '@nestjs/axios';
import { HttpService } from './httpService.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ExternalProviderApiLogService } from '../provider-api-log';

@Global()
@Module({
  imports: [NestHttpModule.register({ timeout: 60000, maxRedirects: 5 })],
  providers: [HttpService, CircuitBreakerService, ExternalProviderApiLogService],
  exports: [HttpService, CircuitBreakerService, ExternalProviderApiLogService],
})
export class HttpModule {}