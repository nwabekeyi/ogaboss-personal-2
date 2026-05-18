/*
  Warnings:

  - Added the required column `lastName` to the `admins` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "firstName" TEXT NOT NULL DEFAULT 'admin',
ADD COLUMN     "lastName" TEXT NOT NULL,
ALTER COLUMN "password" SET DEFAULT 'admin';
