import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * Exported so other modules can send mail with the operator-managed SMTP
 * configuration instead of reading it themselves.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, MailerService],
  exports: [SettingsService, MailerService],
})
export class SettingsModule {}
