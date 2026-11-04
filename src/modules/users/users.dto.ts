import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsString,
  Length,
  ValidateIf,
  registerDecorator,
} from 'class-validator';
export const SUPPORTED_LOCALES = ['fr'] as const;
const timezones = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);
export const isSupportedTimezone = (value: unknown): boolean =>
  typeof value === 'string' && timezones.has(value);
const optional = (_object: unknown, value: unknown): boolean =>
  value !== undefined;
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName?: string;
}
function IsSupportedTimezone(): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isSupportedTimezone',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: { validate: isSupportedTimezone },
    });
}
export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES })
  @ValidateIf(optional)
  @IsIn(SUPPORTED_LOCALES)
  locale?: string;
  @ApiPropertyOptional({
    example: 'Africa/Abidjan',
    maxLength: 100,
    description: 'Fuseau IANA de Intl.supportedValuesOf(timeZone), ou UTC.',
  })
  @ValidateIf(optional)
  @IsString()
  @Length(1, 100)
  @IsSupportedTimezone()
  timezone?: string;
}
export class UserPreferenceDto {
  @ApiProperty({ enum: SUPPORTED_LOCALES }) locale!: string;
  @ApiProperty({ example: 'Africa/Abidjan' }) timezone!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
