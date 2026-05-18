import { Prisma } from '../../infrastructure/databases/prisma';

export type Decimalish =
  | Prisma.Decimal
  | bigint
  | string
  | number
  | null
  | undefined;

/**
 * Convert a Prisma.Decimal, bigint, string, or number to bigint.
 * Returns 0n for null/undefined/empty.
 */
export function toBigInt(value: Decimalish): bigint {
  if (value == null) return 0n;
  if (typeof value === 'bigint') return value;
  if (value instanceof Prisma.Decimal) return BigInt(value.toFixed(0));
  return BigInt(value);
}

/**
 * Convert a bigint to Prisma.Decimal for database writes.
 */
export function toDecimal(value: bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}
