import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentActor, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PublicUserDto } from '../auth/session.dto.js';
import { ErrorResponseDto } from '../../common/filters/error.dto.js';
import { UsersService } from './users.service.js';
import {
  UpdatePreferencesDto,
  UpdateProfileDto,
  UserPreferenceDto,
} from './users.dto.js';
@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Lire son profil' })
  @ApiOkResponse({ type: PublicUserDto })
  profile(@CurrentActor() actor: AuthenticatedActor) {
    return this.users.profile(actor);
  }
  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Modifier son prénom et son nom',
    description: 'Au moins un champ. Email et userId non modifiables.',
  })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  updateProfile(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: UpdateProfileDto,
  ) {
    return this.users.updateProfile(actor, body);
  }
  @Get('preferences')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Lire ses préférences persistantes' })
  @ApiOkResponse({ type: UserPreferenceDto })
  preferences(@CurrentActor() actor: AuthenticatedActor) {
    return this.users.preferences(actor);
  }
  @Patch('preferences')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Modifier ses préférences',
    description:
      'Locale fr ; fuseaux IANA pris en charge par Node et UTC. Au moins un champ.',
  })
  @ApiOkResponse({ type: UserPreferenceDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  updatePreferences(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: UpdatePreferencesDto,
  ) {
    return this.users.updatePreferences(actor, body);
  }
}
