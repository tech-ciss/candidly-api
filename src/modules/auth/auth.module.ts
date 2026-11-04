import { PasswordRecoveryController } from './password-recovery.controller.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { PasswordRecoveryRepository } from './password-recovery.repository.js';
import { PasswordResetDeliveryService } from './password-reset-delivery.service.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { SessionRepository } from './session.repository.js';
import { SessionCookieService } from './session-cookie.service.js';
import { CookieCsrfGuard } from './cookie-csrf.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AccessTokenService } from './access-token.service.js';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { EmailTransport } from '../../integrations/email/email.transport.js';
import { LocalEmailTransport } from '../../integrations/email/local-email.transport.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { VerificationDeliveryService } from './verification-delivery.service.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthRateLimitStore } from './auth-rate-limit.store.js';
@Module({
  imports: [PrismaModule],
  controllers: [AuthController, SessionController, PasswordRecoveryController],
  exports: [JwtAuthGuard, AccessTokenService, SessionRepository],
  providers: [
    PasswordRecoveryService,
    PasswordRecoveryRepository,
    PasswordResetDeliveryService,
    SessionService,
    SessionRepository,
    SessionCookieService,
    CookieCsrfGuard,
    JwtAuthGuard,
    AccessTokenService,
    AuthService,
    AuthRepository,
    PasswordService,
    VerificationDeliveryService,
    AuthRateLimitGuard,
    AuthRateLimitStore,
    { provide: EmailTransport, useClass: LocalEmailTransport },
  ],
})
export class AuthModule {}
