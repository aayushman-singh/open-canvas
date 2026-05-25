ALTER TABLE "customer" ADD COLUMN "display_name" text;
ALTER TABLE "customer" ADD COLUMN "bio" text;
ALTER TABLE "customer" ADD COLUMN "timezone" text NOT NULL DEFAULT 'UTC';
