import { Global, Module } from '@nestjs/common';
import { HttpModule as NestHttpModule } from '@nestjs/axios';
import { HttpService } from './httpService.service';
import { CircuitBreakerService } from './circuit-breaker.service';

@Global()
@Module({
  imports: [NestHttpModule.register({ timeout: 60000, maxRedirects: 5 })],
  providers: [HttpService, CircuitBreakerService],
  exports: [HttpService, CircuitBreakerService],
})
export class HttpModule {}
