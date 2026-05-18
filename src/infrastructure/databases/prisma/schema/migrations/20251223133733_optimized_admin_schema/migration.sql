/*
  Warnings:

  - You are about to drop the column `firstName` on the `admins` table. All the data in the column will be lost.
  - You are about to drop the column `isDeactivatedAccount` on the `admins` table. All the data in the column will be lost.
  - You are about to drop the column `isNewUser` on the `admins` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `admins` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `admins` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `roles` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."roles_name_key";

-- AlterTable
ALTER TABLE "admins" DROP COLUMN "firstName",
DROP COLUMN "isDeactivatedAccount",
DROP COLUMN "isNewUser",
DROP COLUMN "lastName",
DROP COLUMN "status";

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "name",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "title" TEXT;
