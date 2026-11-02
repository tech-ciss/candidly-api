import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // generate/validate ne nécessitent pas de connexion ; migrate exige DATABASE_URL.
  datasource: { url: process.env.DATABASE_URL },
});
