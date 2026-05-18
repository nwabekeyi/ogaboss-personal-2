/*
  Warnings:

  - You are about to drop the `bankaccounts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."bankaccounts" DROP CONSTRAINT "bankaccounts_userId_fkey";

-- DropTable
DROP TABLE "public"."bankaccounts";
