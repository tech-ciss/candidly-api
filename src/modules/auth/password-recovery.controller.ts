import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/filters/error.dto.js';
import { CurrentActor, JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import { CookieCsrfGuard } from './cookie-csrf.guard.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { SessionCookieService } from './session-cookie.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import {
  ChangePasswordDto,
  ResetPasswordDto,
} from './password-recovery.dto.js';
import { AuthResponseDto, EmailDto } from './dto/auth.dto.js';
@ApiTags('auth')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@Controller('auth')
export class PasswordRecoveryController {
  constructor(
    private readonly recovery: PasswordRecoveryService,
    private readonly cookies: SessionCookieService,
  ) {}
  @Post('change-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthRateLimitGuard, JwtAuthGuard, CookieCsrfGuard)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'FRONTEND_URL exacte.',
  })
  @ApiHeader({ name: 'X-Candidly-CSRF', required: true, example: '1' })
  @ApiOperation({
    summary: 'Changer son mot de passe et révoquer toutes ses sessions',
    description:
      'Ancien mot de passe requis. Cookie courant effacé ; nouvelle connexion obligatoire.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async change(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.recovery.change(
      actor.userId,
      body.currentPassword,
      body.newPassword,
    );
    this.cookies.clear(response);
    return result;
  }
  @Post('forgot-password')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Demander un lien de récupération',
    description:
      'Réponse générique pour compte inconnu, vérifié ou non. Demande durable et cooldown de compte. Aucun email confirmé implicitement.',
  })
  @ApiAcceptedResponse({ type: AuthResponseDto })
  forgot(@Body() body: EmailDto): Promise<AuthResponseDto> {
    return this.recovery.forgot(body.email);
  }
  @Post('reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Réinitialiser par token à usage unique',
    description:
      'Token initialement valide 30 min. Révoque toutes les sessions, consomme tous les tokens de récupération, ne confirme pas l’email.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  async reset(
    @Body() body: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.recovery.reset(body.token, body.newPassword);
    this.cookies.clear(response);
    return result;
  }
}
