import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface AccessClaims {
  sub: string;
  sid: string;
}
@Injectable()
export class AccessTokenService {
  constructor(private readonly config: ConfigService) {}
  private get key(): Uint8Array {
    return Buffer.from(
      this.config.getOrThrow<string>('JWT_SIGNING_KEY'),
      'base64',
    );
  }
  sign(
    userId: string,
    sessionId: string,
    sessionExpiresAt: Date,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      now + this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS'),
      Math.floor(sessionExpiresAt.getTime() / 1000),
    );
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.config.getOrThrow<string>('JWT_ISSUER'))
      .setAudience(this.config.getOrThrow<string>('JWT_AUDIENCE'))
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.key);
  }
  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        typ: 'JWT',
        issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
        audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
        requiredClaims: ['sub', 'sid', 'iat', 'exp', 'iss', 'aud'],
      });
      const now = Math.floor(Date.now() / 1000);
      if (
        protectedHeader.alg !== 'HS256' ||
        typeof payload.sub !== 'string' ||
        !UUID_PATTERN.test(payload.sub) ||
        typeof payload.sid !== 'string' ||
        !UUID_PATTERN.test(payload.sid) ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.iat! > now ||
        payload.exp! <= payload.iat! ||
        payload.exp! - payload.iat! >
          this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS') ||
        payload.aud !== this.config.get<string>('JWT_AUDIENCE')
      )
        throw new Error();
      return { sub: payload.sub, sid: payload.sid };
    } catch {
      throw new UnauthorizedException();
    }
  }
}
