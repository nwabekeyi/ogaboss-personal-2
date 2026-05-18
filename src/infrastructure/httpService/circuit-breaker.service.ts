import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { HttpServiceException } from './errors';

@Injectable()
export class CircuitBreakerService implements OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  private readonly defaultOptions: CircuitBreaker.Options = {
    timeout: 30000,
    errorThresholdPercentage: 50,
    rollingCountTimeout: 60000,
    rollingCountBuckets: 6,
    volumeThreshold: 5,
    resetTimeout: 30000,
    errorFilter: (error: Error) => {
      if (error instanceof HttpServiceException) {
        return error.status >= 500;
      }
      return false;
    },
  };

  getBreaker(providerName: string, action: () => Promise<any>): CircuitBreaker {
    const existing = this.breakers.get(providerName);
    if (existing) return existing;

    const breaker = new CircuitBreaker(action, this.defaultOptions);

    breaker.on('open', () => {
      this.logger.warn(`Circuit OPENED for ${providerName}`);
    });

    breaker.on('halfOpen', () => {
      this.logger.log(`Circuit HALF-OPEN for ${providerName}`);
    });

    breaker.on('close', () => {
      this.logger.log(`Circuit CLOSED for ${providerName}`);
    });

    breaker.fallback(() => {
      this.logger.error(`Circuit fallback triggered for ${providerName}`);
      throw new ServiceUnavailableException(
        `Provider is temporarily unavailable. Please try again later.`,
      );
    });

    this.breakers.set(providerName, breaker);
    return breaker;
  }

  getStatus(providerName: string) {
    const breaker = this.breakers.get(providerName);
    if (!breaker) return null;
    return {
      provider: providerName,
      state: breaker.opened
        ? 'open'
        : breaker.halfOpen
          ? 'half-open'
          : 'closed',
      stats: breaker.stats,
    };
  }

  getAllStatus() {
    return Array.from(this.breakers.keys()).map((name) => this.getStatus(name));
  }

  onModuleDestroy() {
    for (const [name, breaker] of this.breakers) {
      breaker.removeAllListeners();
      breaker.shutdown();
    }
    this.breakers.clear();
  }
}
