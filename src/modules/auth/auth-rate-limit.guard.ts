import {
  RATE_LIMIT_WINDOW_SECONDS,
  rateLimitFor,
} from './auth-rate-limit.policy.js';
import { Injectable, HttpException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthRateLimitStore } from './auth-rate-limit.store.js';
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly store: AuthRateLimitStore) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const route = context.getHandler().name;
    const allowed = await this.store.consume(
      route,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      rateLimitFor(route),
    );
    if (!allowed) {
      http
        .getResponse<Response>()
        .setHeader('Retry-After', String(RATE_LIMIT_WINDOW_SECONDS));
      throw new HttpException('Trop de requêtes.', 429);
    }
    return true;
  }
}
