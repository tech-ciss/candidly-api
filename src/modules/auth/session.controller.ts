import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  Header,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/filters/error.dto.js';
import { SessionService } from './session.service.js';
import { SessionCookieService } from './session-cookie.service.js';
import { CookieCsrfGuard } from './cookie-csrf.guard.js';
import { JwtAuthGuard, CurrentUser } from './jwt-auth.guard.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import {
  AccessTokenResponseDto,
  LoginDto,
  LoginResponseDto,
  PublicUserDto,
} from './session.dto.js';
@ApiTags('auth')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description:
    'Identifiants, token ou session invalides, expirés ou révoqués ; email non vérifié.',
})
@Controller('auth')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
  ) {}
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthRateLimitGuard, CookieCsrfGuard)
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'FRONTEND_URL exacte.',
  })
  @ApiHeader({ name: 'X-Candidly-CSRF', required: true, example: '1' })
  @ApiOperation({
    summary: 'Se connecter avec un email vérifié',
    description:
      'Cookie refresh HttpOnly ; access token seul dans le JSON. 5 tentatives/IP/15 min.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.sessions.login(body);
    this.cookies.set(response, result.refresh, result.expiresAt);
    return result.body;
  }
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthRateLimitGuard, CookieCsrfGuard)
  @ApiCookieAuth()
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'FRONTEND_URL exacte.',
  })
  @ApiHeader({ name: 'X-Candidly-CSRF', required: true, example: '1' })
  @ApiOperation({
    summary: 'Renouveler et faire tourner le refresh',
    description:
      '30/IP/15 min. Réutilisation : révocation de toute la session, sans grâce concurrente. Échéance absolue inchangée.',
  })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponseDto> {
    try {
      const result = await this.sessions.refresh(this.cookies.read(request));
      this.cookies.set(response, result.refresh, result.expiresAt);
      return result.body;
    } catch (error) {
      if (error instanceof UnauthorizedException) this.cookies.clear(response);
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthRateLimitGuard, CookieCsrfGuard)
  @ApiCookieAuth()
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'FRONTEND_URL exacte.',
  })
  @ApiHeader({ name: 'X-Candidly-CSRF', required: true, example: '1' })
  @ApiOperation({
    summary: 'Révoquer la session et effacer le cookie',
    description:
      'Idempotent, 204 même sans session. Contrôles CSRF et débit restent appliqués.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(this.cookies.read(request));
    this.cookies.clear(response);
  }
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lire son identité publique',
    description:
      'Vérifie la session active en base à chaque requête ; révocation immédiate aux requêtes suivantes.',
  })
  @ApiOkResponse({ type: PublicUserDto })
  me(@CurrentUser() user: PublicUserDto): PublicUserDto {
    return user;
  }
}
