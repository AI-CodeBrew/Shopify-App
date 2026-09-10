-- The Sep 3 migration created "Session" (capitalized, matching the Prisma
-- model name literally, since it predates the @@map("session") added to
-- schema.prisma). @shopify/shopify-app-session-storage-prisma's own
-- pollForTable check looks for a lowercase "session" table specifically, so
-- every OAuth attempt has been failing with MissingSessionTableError since
-- that table was created. Editing the original migration file has no effect
-- once Prisma has recorded it as applied - this rename runs as a new
-- migration instead.
ALTER TABLE "Session" RENAME TO "session";
