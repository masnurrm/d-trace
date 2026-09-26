import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type JwtPayload, type Role } from '@dtrace/shared';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import { durationToMs, generateOpaqueToken, hashToken } from '../../common/utils/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Session } from '../../generated/prisma/client.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  sessionId: string;
}

interface TokenSubject {
  id: string;
  email: string;
  role: Role;
}

interface ClientContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Owns the token lifecycle: issue, rotate, revoke.
 *
 * Model: a short-lived JWT access token (stateless, cheap to verify) paired
 * with a long-lived opaque refresh token (stateful, revocable). Each refresh
 * rotates - the presented token is revoked and a new one issued in a single
 * transaction. Presenting an already-revoked token means it leaked, so the
 * whole family (every rotation descended from that login) is killed.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get jwt() {
    return this.config.get('jwt', { infer: true });
  }

  get refreshTtlMs(): number {
    return durationToMs(this.jwt.refreshTtl);
  }

  get accessTtlMs(): number {
    return durationToMs(this.jwt.accessTtl);
  }

  /** Login and registration: starts a brand-new token family. */
  async issueForUser(user: TokenSubject, client: ClientContext): Promise<IssuedTokens> {
    return this.createSessionTokens(user, randomUUID(), client);
  }

  /**
   * Exchanges a refresh token for a fresh pair. Anything suspicious - unknown,
   * expired, revoked, or belonging to a disabled user - ends the session family
   * rather than merely rejecting the one request.
   */
  async rotate(rawToken: string, client: ClientContext): Promise<IssuedTokens & { userId: string }> {
    const tokenHash = hashToken(rawToken, this.jwt.refreshSecret);

    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
    });

    if (!session) {
      throw AppException.unauthorized('Invalid session', ERROR_CODES.TOKEN_INVALID);
    }

    if (session.revokedAt) {
      await this.revokeFamily(session.familyId);
      throw AppException.unauthorized('Session revoked', ERROR_CODES.SESSION_REVOKED);
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.revokeSession(session.id);
      throw AppException.unauthorized('Session expired', ERROR_CODES.TOKEN_EXPIRED);
    }

    if (!session.user.isActive) {
      await this.revokeFamily(session.familyId);
      throw AppException.unauthorized('Account is disabled', ERROR_CODES.SESSION_REVOKED);
    }

    const issued = await this.createSessionTokens(
      { id: session.user.id, email: session.user.email, role: session.user.role as Role },
      session.familyId,
      client,
      session.id,
    );

    return { ...issued, userId: session.user.id };
  }

  /** Logout: revokes exactly the presented session, leaving other devices alone. */
  async revokeByToken(rawToken: string): Promise<Session | null> {
    const tokenHash = hashToken(rawToken, this.jwt.refreshSecret);
    const session = await this.prisma.session.findUnique({ where: { tokenHash } });
    if (!session || session.revokedAt) return session;

    return this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used after a password change and by "sign out everywhere". */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Housekeeping for a scheduled job: expired sessions carry no value. */
  async purgeExpiredSessions(olderThan: Date = new Date()): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: olderThan } },
    });
    return result.count;
  }

  private async createSessionTokens(
    user: TokenSubject,
    familyId: string,
    client: ClientContext,
    replacesSessionId?: string,
  ): Promise<IssuedTokens> {
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: user.id,
          familyId,
          tokenHash: hashToken(refreshToken, this.jwt.refreshSecret),
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
          expiresAt,
        },
        select: { id: true },
      });

      if (replacesSessionId) {
        await tx.session.update({
          where: { id: replacesSessionId },
          data: { revokedAt: new Date(), replacedById: created.id },
        });
      }

      return created;
    });

    const payload: JwtPayload = { sub: user.id, role: user.role, sid: session.id };

    const accessToken = await this.jwtService.signAsync(
      { ...payload, email: user.email },
      {
        secret: this.jwt.accessSecret,
        expiresIn: Math.floor(this.accessTtlMs / 1000),
        issuer: this.jwt.issuer,
        audience: this.jwt.audience,
        algorithm: 'HS256',
      },
    );

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: Math.floor(this.accessTtlMs / 1000),
      refreshTokenExpiresIn: Math.floor(this.refreshTtlMs / 1000),
      sessionId: session.id,
    };
  }
}
