import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        statement_timeout: 2000,
        max: 5,
      }),
      errorFormat: 'minimal',
      log: [],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      await this.ping();
    } catch {
      await this.$disconnect();
      // Ne jamais inclure l'erreur du driver ou l'URL de connexion.
      this.logger.error(
        'Connexion PostgreSQL impossible. Vérifier la configuration et le service local.',
      );
      throw new Error('Connexion PostgreSQL impossible.');
    }
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
