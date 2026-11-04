import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import type { UpdateProfileDto, UpdatePreferencesDto } from './users.dto.js';
@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}
  profile(actor: AuthenticatedActor) {
    return this.repository.profile(actor);
  }
  updateProfile(actor: AuthenticatedActor, body: UpdateProfileDto) {
    if (body.firstName === undefined && body.lastName === undefined)
      throw new BadRequestException();
    return this.repository.updateProfile(actor, body);
  }
  preferences(actor: AuthenticatedActor) {
    return this.repository.preferences(actor);
  }
  updatePreferences(actor: AuthenticatedActor, body: UpdatePreferencesDto) {
    if (body.locale === undefined && body.timezone === undefined)
      throw new BadRequestException();
    return this.repository.updatePreferences(actor, body);
  }
}
