import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PasswordService } from './password.service.js';
import { PasswordRecoveryRepository } from './password-recovery.repository.js';
import type { AuthResponseDto } from './dto/auth.dto.js';
@Injectable()
export class PasswordRecoveryService {
  constructor(
    private readonly repository: PasswordRecoveryRepository,
    private readonly passwords: PasswordService,
  ) {}
  async forgot(email: string): Promise<AuthResponseDto> {
    await this.repository.request(email);
    return {
      success: true,
      message:
        'Si cette demande est éligible, un message de récupération sera préparé.',
    };
  }
  async change(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResponseDto> {
    const user = await this.repository.credentials(userId);
    if (
      !(await this.passwords.verify(user?.passwordHash, currentPassword)) ||
      !user
    )
      throw new UnauthorizedException();
    const nextHash = await this.passwords.hash(newPassword);
    if (!(await this.repository.change(userId, user.passwordHash, nextHash)))
      throw new UnauthorizedException();
    return {
      success: true,
      message: 'Votre mot de passe a été modifié. Veuillez vous reconnecter.',
    };
  }
  async reset(token: string, newPassword: string): Promise<AuthResponseDto> {
    // Hash hors verrou, puis revalidation sous verrou ; aucun mot de passe brut dans le repository.
    if (
      !(await this.repository.reset(
        token,
        await this.passwords.hash(newPassword),
      ))
    )
      throw new BadRequestException();
    return {
      success: true,
      message:
        'Votre mot de passe a été réinitialisé. Veuillez vous reconnecter.',
    };
  }
}
