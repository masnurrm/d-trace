import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  ROLES,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type Role,
  type SessionUser,
} from '@dtrace/shared';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { USER_PUBLIC_SELECT } from '../users/user.select.js';
import { toSessionUser } from '../users/user.mapper.js';
import { PasswordService } from './password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';

export interface AuthResult {
  user: SessionUser;
  tokens: IssuedTokens;
}

/**
 * Authentication use cases. Everything that can change who you are is written
 * to the audit trail, failures included - a login that never succeeded is
 * often the more interesting record.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async register(input: RegisterInput, client: ClientInfo): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    // Self-registration must not double as an account prober: the message is
    // identical whether or not the address is already taken.
    if (existing) {
      throw AppException.conflict('Could not create the account with those details');
    }

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await this.passwordService.hash(input.password),
        role: ROLES.VIEWER,
      },
      select: USER_PUBLIC_SELECT,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.AUTH_REGISTER,
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    const tokens = await this.tokenService.issueForUser(
      { id: user.id, email: user.email, role: user.role as Role },
      client,
    );

    return { user: toSessionUser(user), tokens };
  }

  async login(input: LoginInput, client: ClientInfo): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        passwordHash: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      // Spend the same CPU as a real verification, then fail identically.
      await this.passwordService.dummyVerify();
      await this.recordFailedLogin(input.email, client, 'unknown-account');
      throw AppException.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.recordFailedLogin(input.email, client, 'locked', user.id);
      throw AppException.unauthorized(
        'Account temporarily locked after repeated failed attempts',
        ERROR_CODES.FORBIDDEN,
      );
    }

    const valid = await this.passwordService.verify(user.passwordHash, input.password);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.recordFailedLogin(input.email, client, 'bad-password', user.id);
      throw AppException.invalidCredentials();
    }

    // Deactivated accounts fail after the password check, so the response is
    // indistinguishable from a wrong password to someone without the password.
    if (!user.isActive) {
      await this.recordFailedLogin(input.email, client, 'inactive', user.id);
      throw AppException.invalidCredentials();
    }

    const refreshed = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: USER_PUBLIC_SELECT,
    });

    this.logger.log({
      event: 'auth.login',
      userId: user.id,
      email: user.email,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    const tokens = await this.tokenService.issueForUser(
      { id: user.id, email: user.email, role: user.role as Role },
      client,
    );

    return { user: toSessionUser(refreshed), tokens };
  }

  async refresh(rawToken: string, client: ClientInfo): Promise<AuthResult> {
    const rotated = await this.tokenService.rotate(rawToken, client);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
      select: USER_PUBLIC_SELECT,
    });

    this.logger.log({
      event: 'auth.refresh',
      userId: user.id,
      sessionId: rotated.sessionId,
      ip: client.ip,
    });

    return { user: toSessionUser(user), tokens: rotated };
  }

  async logout(rawToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!rawToken) return;

    const session = await this.tokenService.revokeByToken(rawToken);
    if (!session) return;

    this.logger.log({
      event: 'auth.logout',
      userId: session.userId,
      sessionId: session.id,
      ip: client.ip,
    });
  }

  async logoutEverywhere(userId: string, client: ClientInfo): Promise<{ revoked: number }> {
    const revoked = await this.tokenService.revokeAllForUser(userId);

    this.logger.log({
      event: 'auth.logout_all',
      userId,
      revoked,
      ip: client.ip,
    });

    return { revoked };
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    client: ClientInfo,
  ): Promise<{ revokedSessions: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true },
    });

    const valid = await this.passwordService.verify(user.passwordHash, input.currentPassword);
    if (!valid) {
      throw AppException.unauthorized(
        'Current password is incorrect',
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwordService.hash(input.newPassword),
        passwordChangedAt: new Date(),
      },
    });

    // Changing a password invalidates every session, including this one.
    // That is the point: if the old password leaked, so did the old sessions.
    const revokedSessions = await this.tokenService.revokeAllForUser(userId);

    await this.auditService.record({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
      entity: 'User',
      entityId: userId,
      actorId: userId,
      actorEmail: user.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { revokedSessions },
    });

    return { revokedSessions };
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_PUBLIC_SELECT,
    });
    if (!user || !user.isActive) throw AppException.unauthorized('Session is no longer valid');

    return toSessionUser(user);
  }

  /** Increments the failure counter, locking the account once it crosses the limit. */
  private async registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
    const { maxFailedLogins, lockoutMinutes } = this.config.get('security', { infer: true });
    const attempts = currentAttempts + 1;
    const shouldLock = attempts >= maxFailedLogins;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
      },
    });

    if (shouldLock) {
      this.logger.warn({ userId }, 'Account locked after repeated failed logins');
    }
  }

  private async recordFailedLogin(
    email: string,
    client: ClientInfo,
    reason: string,
    userId?: string,
  ): Promise<void> {
    // Warn, not info: a run of these is the signal someone is guessing, and
    // it should stand out to whatever reads the logs.
    this.logger.warn({
      event: 'auth.login_failed',
      email,
      reason,
      userId: userId ?? null,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }
}
