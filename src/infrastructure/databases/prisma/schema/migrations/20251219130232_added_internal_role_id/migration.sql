/*
  Warnings:

  - You are about to drop the column `userGroup` on the `admins` table. All the data in the column will be lost.
  - You are about to drop the `_InternalUserRoles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `internal_users` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[internalRoleId]` on the table `admins` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "public"."_InternalUserRoles" DROP CONSTRAINT "_InternalUserRoles_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_InternalUserRoles" DROP CONSTRAINT "_InternalUserRoles_B_fkey";

-- AlterTable
ALTER TABLE "admins" DROP COLUMN "userGroup",
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "internalRoleId" TEXT;

-- DropTable
DROP TABLE "public"."_InternalUserRoles";

-- DropTable
DROP TABLE "public"."internal_users";

-- CreateIndex
CREATE UNIQUE INDEX "admins_internalRoleId_key" ON "admins"("internalRoleId");

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_internalRoleId_fkey" FOREIGN KEY ("internalRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
