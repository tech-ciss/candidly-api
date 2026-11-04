import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EmailTransport } from './email.transport.js';
import type { VerificationEmail } from './email.transport.js';
@Injectable()
export class LocalEmailTransport extends EmailTransport {
  constructor(private readonly config: ConfigService) {
    super();
  }
  async send(message: VerificationEmail): Promise<void> {
    if (
      this.config.get<string>('EMAIL_TRANSPORT') !== 'local' ||
      this.config.get<string>('NODE_ENV') === 'production'
    )
      throw new Error('Transport email indisponible.');
    const directory = resolve(
      this.config.getOrThrow<string>('EMAIL_LOCAL_DIRECTORY'),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(
      join(directory, `${randomUUID()}.json`),
      JSON.stringify(message, null, 2),
      { mode: 0o600, flag: 'wx' },
    );
  }
}
