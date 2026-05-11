import { defineConfig } from 'drizzle-kit';

const ownerUrl = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
if (!ownerUrl) {
  throw new Error('drizzle.config.ts: DATABASE_OWNER_URL (or DATABASE_URL) must be set');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  dbCredentials: { url: ownerUrl },
  strict: true,
  verbose: true,
});
