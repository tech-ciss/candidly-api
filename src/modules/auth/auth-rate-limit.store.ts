import { RATE_LIMIT_WINDOW_SECONDS } from './auth-rate-limit.policy.js';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { createHash } from 'node:crypto';

const script = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n;`;
@Injectable()
export class AuthRateLimitStore implements OnModuleDestroy {
  constructor(private readonly config: ConfigService) {}
  // Une connexion courte par contrôle ; aucun reconnect infini en cas de panne.
  private readonly clients = new Set<ReturnType<typeof createClient>>();
  async consume(
    route: string,
    address: string,
    limit: number,
  ): Promise<boolean> {
    const client = createClient({
      socket: {
        host: this.config.getOrThrow<string>('REDIS_HOST'),
        port: this.config.getOrThrow<number>('REDIS_PORT'),
        connectTimeout: 1500,
        reconnectStrategy: false,
      },
      disableOfflineQueue: true,
    });
    client.on('error', () => undefined);
    this.clients.add(client);
    let timer: NodeJS.Timeout | undefined;
    try {
      const operation = async (): Promise<boolean> => {
        await client.connect();
        const key =
          'candidly:auth:rate:' +
          route +
          ':' +
          createHash('sha256').update(address).digest('hex');
        const result = await client.eval(script, {
          keys: [key],
          arguments: [String(RATE_LIMIT_WINDOW_SECONDS)],
        });
        return typeof result === 'number' && result <= limit;
      };
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error()), 2000);
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException();
    } finally {
      clearTimeout(timer);
      if (client.isOpen) client.destroy();
      this.clients.delete(client);
    }
  }
  onModuleDestroy(): void {
    for (const client of this.clients) if (client.isOpen) client.destroy();
  }
}
