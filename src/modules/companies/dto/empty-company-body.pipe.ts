import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
// Les actions sans paramètres métier ne doivent pas accepter de champs ignorés.
export class EmptyCompanyBodyPipe implements PipeTransform<unknown, void> {
  transform(value: unknown): void {
    if (value === undefined) return;
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return;
    throw new BadRequestException('Cette action n’accepte aucun champ.');
  }
}
