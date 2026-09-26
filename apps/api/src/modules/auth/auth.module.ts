import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SignatureService } from './signature.service.js';
import { TokenService } from './token.service.js';

/**
 * `JwtModule` is registered without a default secret on purpose: every sign and
 * verify call passes its own secret, which keeps the access-token secret and the
 * refresh pepper from ever being interchangeable by accident.
 *
 * It is `global` because `JwtAuthGuard` is bound globally in AppModule and has
 * to resolve `JwtService` from the root injector.
 */
@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SignatureService, TokenService],
  exports: [AuthService, PasswordService, SignatureService, TokenService],
})
export class AuthModule {}
