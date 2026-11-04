import { Logger } from '@nestjs/common';
import {
  StructuredLogger,
  structuredLog,
} from '../common/observability/structured-logger.js';
Logger.overrideLogger(new StructuredLogger());
import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import {
  assertLocalMaintenance,
  cleanupTechnicalData,
} from './technical-cleanup.js';
async function main(): Promise<void> {
  const apply = assertLocalMaintenance(
    { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL },
    process.argv.slice(2),
  );
  const prisma = new PrismaService(
    new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
  );
  try {
    await prisma.onModuleInit();
    process.stdout.write(
      JSON.stringify(await cleanupTechnicalData(prisma, apply)) + '\n',
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}
void main().catch(() => {
  structuredLog({
    level: 'error',
    module: 'Application',
    event: 'maintenance.failed',
  });
  process.exitCode = 1;
});
