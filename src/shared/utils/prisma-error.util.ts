import { Logger } from '@nestjs/common';
import { Prisma } from '../../infrastructure/databases/prisma/generated/prisma/client';

const TRANSIENT_CODES = new Set([
  'P1000', // Authentication failed
  'P1001', // Can't reach database server
  'P1002', // Database server connection timed out
  'P1003', // Database does not exist
  'P1008', // Operations timed out
  'P1010', // User was denied access
  'P1011', // Error opening a TLS connection
  'P1017', // Server has closed the connection
  'P2024', // Connection pool timeout
  'P2034', // Transaction conflict / write conflict
]);

export function isPrismaError(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}

export function isTransientPrismaError(err: unknown): boolean {
  return isPrismaError(err) && TRANSIENT_CODES.has(err.code);
}

export function handleWebhookDbError(
  err: unknown,
  context: string,
  logger: Logger,
): { shouldRetry: boolean } {
  if (isPrismaError(err)) {
    if (isTransientPrismaError(err)) {
      logger.error(
        `Transient Prisma error in ${context} [${err.code}]: ${err.message}`,
      );
      return { shouldRetry: true };
    }

    logger.warn(
      `Non-transient Prisma error in ${context} [${err.code}]: ${err.message}`,
    );
    return { shouldRetry: false };
  }

  logger.error(
    `Unexpected error in ${context}: ${err instanceof Error ? err.message : err}`,
  );
  return { shouldRetry: false };
}
