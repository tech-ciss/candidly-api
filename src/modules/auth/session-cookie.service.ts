import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, CookieOptions } from 'express';
import { REFRESH_PATTERN } from './session.service.js';
export const REFRESH_COOKIE = 'candidly_refresh';
@Injectable()
export class SessionCookieService {
  constructor(private readonly config: ConfigService) {}
  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
    };
  }
  read(request: Request): string | undefined {
    // Lecture étroite : un cookie unique, aucune dépendance de parsing globale.
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value.startsWith(REFRESH_COOKIE + '='));
    if (cookies.length !== 1) return undefined;
    const value = cookies[0]!.slice(REFRESH_COOKIE.length + 1);
    return REFRESH_PATTERN.test(value) ? value : undefined;
  }
  set(response: Response, token: string, expiresAt: Date): void {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.options(),
      expires: expiresAt,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }
  clear(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, this.options());
  }
}
