import { Logger } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';

const TRANSIENT_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
  'P2034',
]);

export function isPrismaError(
  err: unknown,
): err is PrismaClientKnownRequestError {
  return err instanceof PrismaClientKnownRequestError;
}

export function isTransientPrismaError(err: unknown): boolean {
  return isPrismaError(err) && TRANSIENT_CODES.has((err as PrismaClientKnownRequestError).code);
}

export function handleWebhookDbError(
  err: unknown,
  context: string,
  logger: Logger,
): { shouldRetry: boolean } {
  if (isPrismaError(err)) {
    const code = (err as PrismaClientKnownRequestError).code;
    if (isTransientPrismaError(err)) {
      logger.error(
        `Transient Prisma error in ${context} [${code}]: ${(err as Error).message}`,
      );
      return { shouldRetry: true };
    }

    logger.warn(
      `Non-transient Prisma error in ${context} [${code}]: ${(err as Error).message}`,
    );
    return { shouldRetry: false };
  }

  logger.error(
    `Unexpected error in ${context}: ${err instanceof Error ? err.message : err}`,
  );
  return { shouldRetry: false };
}
