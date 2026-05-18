-- CreateTable
CREATE TABLE "CompanyLiquidity" (
    "id" TEXT NOT NULL,
    "totalBalance" BIGINT NOT NULL DEFAULT 0,
    "reservedBalance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLiquidity_pkey" PRIMARY KEY ("id")
);
