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
import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';
import {
  isPrismaError,
  isTransientPrismaError,
} from '../../shared/utils/prisma-error.util';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const stack = exception instanceof Error ? exception.stack : undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] = [];

    // Handle Prisma errors explicitly
    if (isPrismaError(exception)) {
      this.logger.error(
        `Prisma error [${(exception as PrismaClientKnownRequestError).code}]: ${this.getPrismaSafeMessage(exception)}`,
        stack,
      );

      if (isTransientPrismaError(exception)) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Service temporarily unavailable. Please try again.';
      } else if (this.isTransactionTimeout(exception)) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Service temporarily unavailable. Please try again.';
      } else if (this.isNotFoundError(exception)) {
        status = HttpStatus.NOT_FOUND;
        message = 'The requested resource was not found.';
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Internal server error';
      }

      errors = [message];
      response.status(status).json({
        statusCode: status,
        message,
        errors,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    const err = exception instanceof Error ? exception : null;

    // Handle transaction timeout errors from pg
    if (
      err &&
      (err.message?.includes('Connection terminated') ||
        err.message?.includes('connection timeout') ||
        err.message?.includes('ETIMEDOUT'))
    ) {
      this.logger.error(`Database connection error: ${err.message}`, err.stack);
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Service temporarily unavailable. Please try again.';
      errors = [message];
      response.status(status).json({
        statusCode: status,
        message,
        errors,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

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

      this.logger.error(`Unhandled exception: ${errorMessage}`, stack);

      message = 'Internal server error';
      errors = [message];
    }

    response.status(status).json({
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private getPrismaSafeMessage(err: PrismaClientKnownRequestError): string {
    if (this.isTransactionTimeout(err)) {
      return 'Transaction timed out';
    }
    if (this.isConnectionError(err)) {
      return 'Database connection error';
    }
    return 'Database operation failed';
  }

  private isTransactionTimeout(
    err: PrismaClientKnownRequestError,
  ): boolean {
    return (
      err.code === 'P2028' ||
      err.message?.includes('expired transaction') ||
      err.message?.includes('timeout')
    );
  }

  private isConnectionError(
    err: PrismaClientKnownRequestError,
  ): boolean {
    return isTransientPrismaError(err);
  }

  private isNotFoundError(
    err: PrismaClientKnownRequestError,
  ): boolean {
    return err.code === 'P2025';
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
