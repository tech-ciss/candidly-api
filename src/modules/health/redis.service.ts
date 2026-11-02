import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(private readonly config: ConfigService) {}

  async ping(): Promise<void> {
    // Une connexion courte, bornée et sans reconnexion automatique pour chaque sonde.
    // Aucun client de queue métier n'est créé dans ce ticket.
    const client = createClient({
      socket: {
        host: this.config.getOrThrow<string>('REDIS_HOST'),
        port: this.config.getOrThrow<number>('REDIS_PORT'),
        connectTimeout: 1500,
        reconnectStrategy: false,
      },
    });
    client.on('error', () => {
      /* L'erreur est rendue sous forme de statut, sans détails sensibles. */
    });
    this.clients.add(client);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await client.connect();
          if ((await client.ping()) !== 'PONG')
            throw new Error('Redis indisponible.');
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Délai Redis dépassé.')),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (client.isOpen) client.destroy();
      this.clients.delete(client);
    }
  }

  private readonly clients = new Set<ReturnType<typeof createClient>>();

  onModuleDestroy(): void {
    for (const client of this.clients) {
      if (client.isOpen) client.destroy();
    }
    this.clients.clear();
  }
}
