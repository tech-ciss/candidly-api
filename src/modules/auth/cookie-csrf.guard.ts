import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
@Injectable()
export class CookieCsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !==
        this.config.getOrThrow<string>('FRONTEND_URL') ||
      request.headers['x-candidly-csrf'] !== '1'
    )
      throw new ForbiddenException();
    return true;
  }
}
