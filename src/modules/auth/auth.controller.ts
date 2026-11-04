import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/filters/error.dto.js';
import { AuthService } from './auth.service.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import {
  AuthResponseDto,
  EmailDto,
  RegisterDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';
@ApiTags('auth')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description:
    'Données invalides ; token inconnu, expiré ou consommé pour la vérification.',
})
@ApiTooManyRequestsResponse({
  type: ErrorResponseDto,
  description:
    'Limite par IP et endpoint sur 15 minutes ; Retry-After en secondes.',
})
@ApiServiceUnavailableResponse({
  type: ErrorResponseDto,
  description: 'Dépendance temporairement indisponible.',
})
@UseGuards(AuthRateLimitGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Demander une inscription',
    description:
      'Réponse identique pour une adresse déjà inscrite. Aucun compte existant n’est modifié. Envoi asynchrone, sans session.',
  })
  @ApiAcceptedResponse({ type: AuthResponseDto })
  register(@Body() body: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(body);
  }
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vérifier une adresse email',
    description:
      'Usage unique, expiration et consommation atomique des autres tokens. Ne crée aucune session.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  verify(@Body() body: VerifyEmailDto): Promise<AuthResponseDto> {
    return this.auth.verify(body.token);
  }
  @Post('resend-verification')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Redemander une vérification',
    description:
      'Réponse générique pour compte inconnu, déjà vérifié ou délai de renvoi non écoulé. Aucun envoi dans ces cas.',
  })
  @ApiAcceptedResponse({ type: AuthResponseDto })
  resend(@Body() body: EmailDto): Promise<AuthResponseDto> {
    return this.auth.resend(body.email);
  }
}
