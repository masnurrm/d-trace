import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ROLES,
  testEmailSchema,
  updateSettingsSchema,
  type Role,
  type TestEmailInput,
  type UpdateSettingsInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { MailerService } from './mailer.service.js';
import { SettingsService } from './settings.service.js';

/**
 * Reading is open to every signed-in user, because the shell needs the app
 * name, the marquee and the footer to render. Writing is ADMIN only.
 *
 * The mail section is the exception on read: it is omitted entirely for
 * non-administrators rather than returned with blanked fields, so a lower role
 * cannot even learn which provider is configured.
 */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly mailerService: MailerService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Application settings for the current role.' })
  get(@CurrentUser('role') role: Role) {
    return this.settingsService.get(role);
  }

  @Put()
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Replace the settings document' })
  update(
    @Body(zodPipe(updateSettingsSchema)) body: UpdateSettingsInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.settingsService.update(body, actor, client);
  }

  @Post('email/test')
  @MinRole(ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  // Outbound mail is a resource someone else pays for, and a test endpoint is
  // an obvious relay to abuse. Keep it scarce.
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Send a test message using the stored SMTP settings' })
  async testEmail(
    @Body(zodPipe(testEmailSchema)) body: TestEmailInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    try {
      const result = await this.mailerService.sendTestEmail(body.to);
      this.settingsService.recordEmailTest(actor, client, body.to, 'sent');
      return { sent: true, messageId: result.messageId };
    } catch (error) {
      const reason = error instanceof AppException ? error.message : 'unknown';
      this.settingsService.recordEmailTest(actor, client, body.to, 'failed', reason);
      throw error;
    }
  }
}
