import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  changePasswordSchema,
  saveSignatureSchema,
  loginSchema,
  registerSchema,
  type ChangePasswordInput,
  type SaveSignatureInput,
  type LoginInput,
  type RegisterInput,
} from '@dtrace/shared';
import type { AppConfig } from '../../config/configuration.js';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  REFRESH_COOKIE_NAME,
  clearedRefreshCookieOptions,
  refreshCookieOptions,
} from '../../common/constants/cookies.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.js';
import { AuthService, type AuthResult } from './auth.service.js';
import { SignatureService } from './signature.service.js';
import { TokenService } from './token.service.js';

/**
 * Token transport, decided once and applied consistently:
 *
 *  - the refresh token leaves the server only as a signed, httpOnly cookie, so
 *    no script can read it and no XSS can exfiltrate it;
 *  - the access token is returned in the JSON body and is meant to be held in
 *    memory by the caller (the Next.js BFF), never in localStorage.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly signatures: SignatureService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Post('register')
  // Per address: registration is unauthenticated, and cheap to abuse.
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Create an account (always starts at the VIEWER role)' })
  async register(
    @Body(zodPipe(registerSchema)) body: RegisterInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(body, client);
    return this.respondWithSession(result, response);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // The brute-force surface. Tight, per address, per minute.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange credentials for an access token + refresh cookie' })
  async login(
    @Body(zodPipe(loginSchema)) body: LoginInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(body, client);
    return this.respondWithSession(result, response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  // Looser: a legitimate browser refreshes whenever its access token ages out.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh cookie and mint a new access token' })
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readRefreshCookie(request);
    if (!token) throw AppException.unauthorized('Missing refresh token');

    const result = await this.authService.refresh(token, client);
    return this.respondWithSession(result, response);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session and clear the cookie' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Public on purpose: logging out with an expired access token must still
    // clear the cookie, otherwise a user can get stuck half-authenticated.
    await this.authService.logout(readRefreshCookie(request), client);
    this.clearRefreshCookie(response);
    return { success: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session belonging to the current user' })
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logoutEverywhere(userId, client);
    this.clearRefreshCookie(response);
    return result;
  }

  @Get('me')
  @ApiOkResponse({ description: 'The authenticated principal.' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  /* ------------------------------------------------------------------ */
  /* Signature — always the caller's own, never one named in the request  */
  /* ------------------------------------------------------------------ */

  @Get('me/signature')
  @ApiOkResponse({ description: "The caller's signature, or null when unset." })
  mySignature(@CurrentUser() actor: AuthenticatedUser) {
    return this.signatures.getMine(actor);
  }

  @Put('me/signature')
  @ApiOperation({ summary: 'Set or replace the signature' })
  saveMySignature(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodPipe(saveSignatureSchema)) body: SaveSignatureInput,
    @Client() client: ClientInfo,
  ) {
    return this.signatures.saveMine(body, actor, client);
  }

  @Delete('me/signature')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the signature' })
  removeMySignature(@CurrentUser() actor: AuthenticatedUser, @Client() client: ClientInfo) {
    return this.signatures.removeMine(actor, client);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Change the password; every session is revoked afterwards' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body(zodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.changePassword(userId, body, client);
    this.clearRefreshCookie(response);
    return result;
  }

  private respondWithSession(result: AuthResult, response: Response) {
    const cookie = this.config.get('cookie', { infer: true });

    response.cookie(
      REFRESH_COOKIE_NAME,
      result.tokens.refreshToken,
      refreshCookieOptions(cookie, this.tokenService.refreshTtlMs),
    );

    // Note what is *not* here: the refresh token itself never appears in a body.
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.accessTokenExpiresIn,
      tokenType: 'Bearer' as const,
    };
  }

  private clearRefreshCookie(response: Response): void {
    const cookie = this.config.get('cookie', { infer: true });
    response.clearCookie(REFRESH_COOKIE_NAME, clearedRefreshCookieOptions(cookie));
  }
}

/**
 * Signed cookies land in `signedCookies`; an unsigned value with the same name
 * is ignored, so a client cannot hand-craft a refresh cookie.
 */
function readRefreshCookie(request: AuthenticatedRequest): string | undefined {
  const value = request.signedCookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}
