import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HttpExceptionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpExceptionInterceptor.name);

  constructor(private readonly configService: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const request = context.switchToHttp().getRequest();
        const env = this.configService.get<string>('NODE_ENV') || 'development';

        // Preserve original HttpException if possible
        if (error instanceof HttpException) {
          const response = error.getResponse();
          const status = error.getStatus();

          // Log full error
          this.logger.error(
            `${request.method} ${request.url} - ${status}`,
            error.stack,
          );

          // If it's already a proper HttpException, just re-throw it
          return throwError(() => error);
        }

        // Handle non-HttpException errors (e.g., DB crash, OTP service down)
        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let errorType = 'InternalServerError';
        let stack: string | undefined;

        if (error instanceof Error) {
          message = error.message;
          errorType = error.name;
          stack = error.stack;
        }

        // Log unexpected errors
        this.logger.error(
          `${request.method} ${request.url} - ${status}`,
          stack || 'No stack trace',
        );

        const formattedError = {
          status: 'error',
          statusCode: status,
          message,
          error: errorType,
          timestamp: new Date().toISOString(),
          path: request.url,
          // Only include stack in development
          ...(env !== 'production' && stack ? { stack } : {}),
        };

        return throwError(() => new HttpException(formattedError, status));
      }),
    );
  }
}