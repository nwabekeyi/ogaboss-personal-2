import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, retry, tap } from 'rxjs/operators';

@Injectable()
export class RetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RetryInterceptor.name);

  // Specific error messages that should trigger a retry
  private readonly retriableMessages = [
    'Unable to start a transaction in the given time',
    'Transaction API error: Unable to start a transaction in the given time',
  ];

  // Maximum retry attempts
  private readonly maxRetries = 1;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const request = context.switchToHttp().getRequest();

        // Check if error is retriable
        if (this.isRetriable(error)) {
          this.logger.warn(
            `Retriable error detected on ${request.method} ${request.url}: ${this.getErrorMessage(error)}`,
          );

          // Re-throw to trigger retry operator
          return throwError(() => error);
        }

        // Non-retriable errors, pass through
        return throwError(() => error);
      }),
      // Retry up to maxRetries times on retriable errors
      retry({
        count: this.maxRetries,
        delay: 1000, // 1 second delay between retries
      }),
      tap({
        error: (error) => {
          this.logger.error(`Request failed after retries: ${error.message}`);
        },
      }),
    );
  }

  private isRetriable(error: unknown): boolean {
    const message = this.getErrorMessage(error);
    return this.retriableMessages.some((retriable) =>
      message.includes(retriable),
    );
  }

  private getErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return JSON.stringify(error);
  }
}
