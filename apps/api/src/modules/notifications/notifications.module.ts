import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotificationsService } from './notifications.service.js';
import { SocketTicketService } from './socket-ticket.service.js';

/**
 * The bell, and the email that goes with it when SMTP is configured.
 * `SettingsModule` is imported for the mailer, which reads its credentials
 * from the settings row at send time.
 */
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, SocketTicketService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
