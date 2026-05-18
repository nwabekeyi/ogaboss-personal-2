// src/shared/http/errors.ts
import { ServiceUnavailableException } from '@nestjs/common';

export class HttpServiceException extends Error {
  public readonly status: number;
  public readonly data?: any;

  constructor(message: string, status = 500, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export class CircuitBreakerOpenException extends ServiceUnavailableException {
  constructor(providerName: string) {
    super(
      `${providerName} is temporarily unavailable. Please try again later.`,
    );
  }
}
