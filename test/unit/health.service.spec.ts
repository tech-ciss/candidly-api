import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from '../../src/modules/health/health.service.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { RedisService } from '../../src/modules/health/redis.service.js';

for (const databaseUp of [true, false]) {
  for (const redisUp of [true, false]) {
    void test(`health : PostgreSQL ${String(databaseUp)}, Redis ${String(redisUp)}`, async () => {
      const ping = (up: boolean) => () =>
        up
          ? Promise.resolve()
          : Promise.reject(new Error('private_driver_detail'));
      const health = new HealthService(
        { ping: ping(databaseUp) } as unknown as PrismaService,
        { ping: ping(redisUp) } as unknown as RedisService,
      );
      const services = {
        database: databaseUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      };
      if (databaseUp && redisUp) {
        assert.deepEqual(await health.check(), { status: 'ok', services });
      } else {
        await assert.rejects(health.check(), (error: unknown) => {
          assert.ok(error instanceof ServiceUnavailableException);
          assert.equal(error.getStatus(), 503);
          assert.deepEqual(error.getResponse(), { services });
          assert.ok(
            !JSON.stringify(error.getResponse()).includes(
              'private_driver_detail',
            ),
          );
          return true;
        });
      }
    });
  }
}
