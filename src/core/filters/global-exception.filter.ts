import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { ValidationError } from 'class-validator';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] = [];

    const stack = exception instanceof Error ? exception.stack : undefined;

    // BadRequest / validation
    if (exception instanceof BadRequestException) {
      const res = exception.getResponse() as any;
      status = exception.getStatus();
      message = 'Bad Request';

      const potentialErrors = Array.isArray(res)
        ? res
        : Array.isArray(res?.message)
          ? res.message
          : null;

      if (potentialErrors && this.isValidationErrorArray(potentialErrors)) {
        errors = this.extractConstraintMessages(potentialErrors);
      } else {
        errors = Array.isArray(res?.message)
          ? res.message
          : [res?.message ?? message];
      }
    }

    // Other HTTP exceptions
    else if (exception instanceof HttpException) {
      const res = exception.getResponse() as any;

      status = exception.getStatus();

      const errorMessage =
        typeof res === 'string' ? res : res?.message || exception.message;

      message = errorMessage;
      errors = [errorMessage];
    }

    // Non-HTTP / unknown exceptions
    else {
      const errorMessage =
        exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;

      this.logger.error(`Unhandled exception: ${errorMessage}`, stack);

      message = errorMessage;
      errors = [errorMessage];
    }

    response.status(status).json({
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private isValidationErrorArray(
    errors: unknown[],
  ): errors is ValidationError[] {
    return errors.every(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        'property' in error &&
        ('constraints' in error || 'children' in error),
    );
  }

  private extractConstraintMessages(errors: ValidationError[]): string[] {
    const messages: string[] = [];

    errors.forEach(({ constraints, children }) => {
      if (constraints) {
        messages.push(...Object.values(constraints));
      }

      if (children && children.length > 0) {
        messages.push(...this.extractConstraintMessages(children));
      }
    });

    return messages;
  }
}
