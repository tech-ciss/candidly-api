import { Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
// Cycle de vie commun aux demandes durables ; le stockage et la transaction restent propres à chaque cas.
export abstract class DurableEmailDelivery
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger: Logger;
  protected stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(
    private readonly deliveryConfig: ConfigService,
    name: string,
  ) {
    this.logger = new Logger(name);
  }
  onModuleInit(): void {
    if (
      this.deliveryConfig.get<string>('NODE_ENV') === 'test' ||
      this.deliveryConfig.get<string>('EMAIL_TRANSPORT') === 'disabled'
    )
      return;
    this.timer = setInterval(
      () => {
        void this.runPending();
      },
      this.deliveryConfig.getOrThrow<number>('EMAIL_RETRY_INTERVAL_SECONDS') *
        1000,
    );
    this.timer.unref();
    void this.runPending();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
  runPending(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running ??= this.processBatch()
      .catch(() => {
        this.logger.warn(
          'Préparation des emails indisponible ; reprise au prochain passage.',
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  protected abstract processBatch(): Promise<void>;
}
