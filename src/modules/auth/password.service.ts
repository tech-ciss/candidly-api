import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;
  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }
  private getDummyHash(): Promise<string> {
    return (this.dummyHash ??= this.hash(randomBytes(32).toString('base64')));
  }
  async verify(
    passwordHash: string | undefined,
    password: string,
  ): Promise<boolean> {
    const candidate = passwordHash ?? (await this.getDummyHash());
    try {
      return (await verify(candidate, password)) && passwordHash !== undefined;
    } catch {
      return false;
    }
  }
  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
  }
}
