import {
  actorFromVerifiedSession,
  requireActor,
} from '../../common/authorization/authenticated-actor.js';
import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenService } from './access-token.service.js';
import { SessionRepository } from './session.repository.js';
import type { PublicUserDto } from './session.dto.js';
export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedActor;
  currentUser?: PublicUserDto;
}
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    delete request.auth;
    delete request.currentUser;
    const match = request.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
    );
    if (!match || match[1]!.length > 4096) throw new UnauthorizedException();
    const claims = await this.tokens.verify(match[1]!);
    const user = await this.sessions.activeUser(claims.sid, claims.sub);
    if (!user?.emailVerifiedAt || user.id !== claims.sub)
      throw new UnauthorizedException();
    request.auth = actorFromVerifiedSession(claims.sub, claims.sid);
    request.currentUser = user as PublicUserDto;
    return true;
  }
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUserDto => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = requireActor(request.auth!);
    const user = request.currentUser;
    if (!user || user.id !== actor.userId) throw new UnauthorizedException();
    return user;
  },
);

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    return requireActor(
      context.switchToHttp().getRequest<AuthenticatedRequest>().auth!,
    );
  },
);
