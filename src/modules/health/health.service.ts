import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from './redis.service.js';
import type { HealthResponseDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [database, redis] = await Promise.allSettled([
      this.prisma.ping(),
      this.redis.ping(),
    ]);
    const services = {
      database:
        database.status === 'fulfilled' ? ('up' as const) : ('down' as const),
      redis: redis.status === 'fulfilled' ? ('up' as const) : ('down' as const),
    };
    if (services.database === 'down' || services.redis === 'down') {
      throw new ServiceUnavailableException({ services });
    }
    return { status: 'ok', services };
  }
}
