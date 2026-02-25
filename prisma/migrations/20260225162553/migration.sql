/*
  Warnings:

  - You are about to drop the `daily_stats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `drive_folder_map` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `group_user_filter` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "drive_folder_map" DROP CONSTRAINT "drive_folder_map_chat_id_fkey";

-- DropForeignKey
ALTER TABLE "group_user_filter" DROP CONSTRAINT "group_user_filter_chat_id_fkey";

-- DropTable
DROP TABLE "daily_stats";

-- DropTable
DROP TABLE "drive_folder_map";

-- DropTable
DROP TABLE "group_user_filter";

-- DropEnum
DROP TYPE "FilterMode";
