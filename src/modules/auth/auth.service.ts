import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import type { RegisterDto, AuthResponseDto } from './dto/auth.dto.js';

export const verificationRequestedResponse = (): AuthResponseDto => ({
  success: true,
  message:
    'Si cette demande est éligible, un message de vérification sera préparé.',
});
@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwords: PasswordService,
  ) {}
  async register(input: RegisterDto): Promise<AuthResponseDto> {
    // Même travail de hash pour une inscription nouvelle ou déjà existante.
    await this.repository.register(
      input,
      await this.passwords.hash(input.password),
    );
    return verificationRequestedResponse();
  }
  async resend(email: string): Promise<AuthResponseDto> {
    await this.repository.requestVerification(email);
    return verificationRequestedResponse();
  }
  async verify(token: string): Promise<AuthResponseDto> {
    if (!(await this.repository.verify(token))) throw new BadRequestException();
    return { success: true, message: 'Votre adresse email est vérifiée.' };
  }
}
