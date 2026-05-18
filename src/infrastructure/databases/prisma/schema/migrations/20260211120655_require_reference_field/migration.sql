-- AlterTable
ALTER TABLE "withdrawals" ALTER COLUMN "reference" DROP NOT NULL,
ALTER COLUMN "rawPayload" DROP NOT NULL;
