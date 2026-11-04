import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { PasswordService } from './password.service.js';
import { AccessTokenService } from './access-token.service.js';
import { SessionRepository } from './session.repository.js';
import { hashToken } from './verification-token.js';
import type { LoginDto } from './session.dto.js';
export const REFRESH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function createRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
@Injectable()
export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: AccessTokenService,
    private readonly config: ConfigService,
  ) {}
  private async access(userId: string, sessionId: string, expiresAt: Date) {
    const accessToken = await this.tokens.sign(userId, sessionId, expiresAt);
    const expiresIn = Math.min(
      this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS'),
      Math.max(
        0,
        Math.floor(expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000),
      ),
    );
    return { accessToken, tokenType: 'Bearer' as const, expiresIn };
  }
  async login(input: LoginDto) {
    const user = await this.repository.findCredentials(input.email);
    const valid = await this.passwords.verify(
      user?.passwordHash,
      input.password,
    );
    if (!valid || !user?.emailVerifiedAt) throw new UnauthorizedException();
    const id = randomUUID();
    const refresh = createRefreshToken();
    const expiresAt = new Date(
      Date.now() +
        this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS') * 1000,
    );
    const access = await this.access(user.id, id, expiresAt);
    await this.repository.create(
      id,
      user.id,
      hashToken(refresh),
      expiresAt,
      user.passwordHash,
    );
    const publicUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    };
    return {
      body: { ...access, user: publicUser },
      refresh,
      expiresAt,
    };
  }
  async refresh(raw: string | undefined) {
    if (!raw || !REFRESH_PATTERN.test(raw)) throw new UnauthorizedException();
    const refresh = createRefreshToken();
    const session = await this.repository.rotate(raw, hashToken(refresh));
    if (!session) throw new UnauthorizedException();
    return {
      body: await this.access(session.userId, session.id, session.expiresAt),
      refresh,
      expiresAt: session.expiresAt,
    };
  }
  async logout(raw: string | undefined): Promise<void> {
    if (raw && REFRESH_PATTERN.test(raw)) await this.repository.revoke(raw);
  }
}
