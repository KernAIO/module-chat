import { defineConfig } from 'drizzle-kit'
// Generates SQL migrations for the chat module's own schema. Run: pnpm db:generate
// After generating, append RLS policies (see migrations/0000_init.sql for the pattern / `rlsPolicySql`).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/schema.ts',
  out: './migrations',
  schemaFilter: ['mod_chat'],
})
