-- Per-tab admin access. NULL = full access (existing admins keep everything).
ALTER TABLE "User" ADD COLUMN "adminPermissions" JSONB;
