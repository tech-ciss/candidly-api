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
      route === 'verify' || route === 'refresh' || route === 'logout' ? 30 : 5,
    );
    if (!allowed) {
      http.getResponse<Response>().setHeader('Retry-After', '900');
      throw new HttpException('Trop de requêtes.', 429);
    }
    return true;
  }
}
