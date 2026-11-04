import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { EmailDto } from './dto/auth.dto.js';
export class LoginDto extends EmailDto {
  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty({ format: 'date-time', type: String }) emailVerifiedAt!: Date;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: Date;
}
export class AccessTokenResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: 'Bearer';
  @ApiProperty({ example: 900 }) expiresIn!: number;
}
export class LoginResponseDto extends AccessTokenResponseDto {
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
