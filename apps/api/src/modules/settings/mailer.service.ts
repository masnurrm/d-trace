import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { ERROR_CODES } from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import { SettingsService } from './settings.service.js';

export interface SendResult {
  messageId: string;
  acceptedTo: string[];
}

/**
 * Sends mail using whatever SMTP configuration is stored in Settings.
 *
 * The transport is built per call rather than cached: the configuration is
 * editable at runtime, and a long-lived transport would keep authenticating
 * with credentials the operator has already replaced.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly settingsService: SettingsService) {}

  async sendTestEmail(to: string): Promise<SendResult> {
    const credentials = await this.settingsService.getSmtpCredentials();

    if (!credentials) {
      throw new AppException(
        ERROR_CODES.VALIDATION_FAILED,
        'Konfigurasi email belum lengkap. Isi host, port, dan email pengirim lalu simpan.',
        400,
      );
    }

    const transport = createTransport({
      host: credentials.host,
      port: credentials.port,
      // `secure` means "TLS from the first byte" (usually port 465). STARTTLS
      // upgrades a plaintext connection instead, which nodemailer does when
      // `secure` is false and the server advertises it.
      secure: credentials.encryption === 'SSL_TLS',
      requireTLS: credentials.encryption === 'STARTTLS',
      ...(credentials.username
        ? { auth: { user: credentials.username, pass: credentials.password ?? '' } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    try {
      const info = await transport.sendMail({
        from: credentials.fromName
          ? { name: credentials.fromName, address: credentials.fromEmail }
          : credentials.fromEmail,
        to,
        subject: 'D-Trace — email uji',
        text: 'Konfigurasi email D-Trace berhasil. Pesan ini dikirim dari halaman Pengaturan.',
      });

      return { messageId: info.messageId, acceptedTo: info.accepted.map(String) };
    } catch (error) {
      // The SMTP error text can name the host and the account. It goes to the
      // log; the operator gets the short reason without the internals.
      this.logger.warn({ err: error }, 'Test email failed');
      throw new AppException(
        ERROR_CODES.VALIDATION_FAILED,
        `Gagal mengirim: ${summarise(error)}`,
        400,
      );
    } finally {
      transport.close();
    }
  }

  /**
   * True when mail can actually be sent right now.
   *
   * Callers that notify people use this to decide whether email is part of the
   * delivery at all, rather than attempting a send and treating the failure as
   * routine — an unconfigured mailer and a broken one deserve different
   * reactions, and only this tells them apart.
   */
  async isConfigured(): Promise<boolean> {
    return (await this.settingsService.getSmtpCredentials()) !== null;
  }

  /**
   * Sends one message, and reports failure by returning false.
   *
   * Deliberately different from `sendTestEmail`, which throws: that one exists
   * so an operator can see why their configuration is wrong. This one is used
   * while something else is being saved, and a mail server having a bad minute
   * must never roll back the approval it was announcing. The failure is logged
   * and the in-app notification still stands.
   */
  /**
   * One message to one visible recipient.
   *
   * `trySend` bcc's its recipients so a notification cannot disclose who else
   * was told. An invitation is addressed to one person who is expected to see
   * it is for them, and a message with an empty To line is what spam filters
   * are built to catch.
   */
  async trySendTo(to: string, subject: string, text: string): Promise<boolean> {
    return this.deliver({ to }, subject, text, to);
  }

  async trySend(to: string[], subject: string, text: string): Promise<boolean> {
    const recipients = to.filter(Boolean);
    if (recipients.length === 0) return false;

    // One message per recipient list, addressed with bcc: a notification must
    // not disclose who else was told.
    return this.deliver({ bcc: recipients }, subject, text, `${recipients.length} penerima`);
  }

  /** The one place a transport is built and a message handed to it. */
  private async deliver(
    envelope: { to?: string; bcc?: string[] },
    subject: string,
    text: string,
    describedAs: string,
  ): Promise<boolean> {
    const credentials = await this.settingsService.getSmtpCredentials();
    if (!credentials) return false;

    const transport = createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.encryption === 'SSL_TLS',
      requireTLS: credentials.encryption === 'STARTTLS',
      ...(credentials.username
        ? { auth: { user: credentials.username, pass: credentials.password ?? '' } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    try {
      await transport.sendMail({
        from: credentials.fromName
          ? { name: credentials.fromName, address: credentials.fromEmail }
          : credentials.fromEmail,
        ...envelope,
        subject,
        text,
      });
      return true;
    } catch (error) {
      this.logger.warn({ err: error, subject, to: describedAs }, 'Outgoing email failed');
      return false;
    } finally {
      transport.close();
    }
  }
}

/** A short, safe reason: the SMTP code when there is one, else a generic line. */
function summarise(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'sambungan ke server email gagal';

  const code = (error as { code?: unknown }).code;
  switch (code) {
    case 'EAUTH':
      return 'kredensial ditolak server email';
    case 'ECONNECTION':
    case 'ECONNREFUSED':
      return 'server email tidak dapat dihubungi';
    case 'ETIMEDOUT':
      return 'server email tidak merespons';
    case 'EENVELOPE':
      return 'alamat pengirim atau tujuan ditolak';
    default:
      return 'sambungan ke server email gagal';
  }
}
