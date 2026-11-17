import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import { CompaniesRepository } from './companies.repository.js';
import type {
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesDto,
} from './dto/companies.dto.js';
@Injectable()
export class CompaniesService {
  constructor(private readonly repository: CompaniesRepository) {}
  private async mutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 'P2002')
          throw new ConflictException(
            'Une entreprise portant ce nom existe déjà.',
          );
        if (error.code === 'P2003')
          throw new ConflictException(
            'Cette entreprise possède des relations empêchant sa suppression.',
          );
      }
      throw error;
    }
  }
  create(actor: AuthenticatedActor, data: CreateCompanyDto) {
    return this.mutation(() => this.repository.create(actor, data));
  }
  get(actor: AuthenticatedActor, id: string) {
    return this.repository.get(actor, id);
  }
  list(actor: AuthenticatedActor, query: ListCompaniesDto) {
    return this.repository.list(actor, query);
  }
  update(actor: AuthenticatedActor, id: string, data: UpdateCompanyDto) {
    if (!Object.values(data).some((value) => value !== undefined))
      throw new BadRequestException('Au moins un champ est requis.');
    return this.mutation(() => this.repository.update(actor, id, data));
  }
  archive(actor: AuthenticatedActor, id: string) {
    return this.mutation(() => this.repository.transition(actor, id, true));
  }
  restore(actor: AuthenticatedActor, id: string) {
    return this.mutation(() => this.repository.transition(actor, id, false));
  }
  delete(actor: AuthenticatedActor, id: string) {
    return this.mutation(() => this.repository.delete(actor, id));
  }
}
