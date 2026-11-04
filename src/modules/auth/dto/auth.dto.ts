import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const normalizeEmail = (value: string): string =>
  value.trim().toLowerCase();
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class EmailDto {
  @ApiProperty({ example: 'awa@example.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class RegisterDto extends EmailDto {
  @ApiProperty({ example: 'Awa', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty({ example: 'Kouassi', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
    example: 'MotDePasseFort2026!',
  })
  @IsString()
  @Length(12, 128)
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Token opaque reçu dans le lien de vérification.',
    minLength: 43,
    maxLength: 43,
    writeOnly: true,
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
  @ApiProperty({
    example:
      'Si cette demande est éligible, un message de vérification sera préparé.',
  })
  message!: string;
}
