import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

/**
 * `AuthModule` for the password hasher and `SettingsModule` for the mailer:
 * an invitation is a credential that arrives by email, so it needs both.
 */
@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
