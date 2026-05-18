/*
  Warnings:

  - A unique constraint covering the columns `[title]` on the table `roles` will be added. If there are existing duplicate values, this will fail.
  - Made the column `title` on table `roles` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "title" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "roles_title_key" ON "roles"("title");
