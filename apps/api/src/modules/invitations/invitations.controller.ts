import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  idSchema,
  type AcceptInvitationInput,
  type CreateInvitationInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Two halves with opposite audiences.
 *
 * Creating and revoking are ordinary authenticated calls. Previewing and
 * accepting are `@Public()` by necessity — the person holding the link has no
 * account yet, which is the whole point — so both are rate limited: a public
 * endpoint that takes a token is a public endpoint somebody will try to guess.
 */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Invite somebody who has no account yet' })
  create(
    @Body(zodPipe(createInvitationSchema)) body: CreateInvitationInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.invitations.create(body, actor, client);
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Invitations sent for one project, with their status' })
  listForProject(@Param('projectId', zodPipe(idSchema)) projectId: string) {
    return this.invitations.listForProject(projectId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an invitation nobody has answered' })
  revoke(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.invitations.revoke(id, actor, client);
  }

  @Public()
  @Get('token/:token')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'What the accept page may show before signing in' })
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Turn an invitation into an account' })
  accept(
    @Body(zodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Client() client: ClientInfo,
  ) {
    return this.invitations.accept(body, client);
  }
}
