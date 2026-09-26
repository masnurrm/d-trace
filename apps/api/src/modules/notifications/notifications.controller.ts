import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  type ListNotificationsQuery,
  type MarkNotificationsReadInput,
} from '@dtrace/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { NotificationsService } from './notifications.service.js';
import { SocketTicketService } from './socket-ticket.service.js';

/**
 * The caller's own notifications, and nobody else's.
 *
 * No role guard: every signed-in account has a bell. The scope is the user id
 * on every query, which is a tighter answer than any role could give — there
 * is no notion of "reading someone else's notifications" to authorise.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tickets: SocketTicketService,
  ) {}

  /**
   * A one-shot credential for the notification socket.
   *
   * Called by the BFF, which holds the access token; the browser receives only
   * the ticket. That is what keeps "the browser never sees a token" true even
   * though the socket connects to the API directly.
   */
  @Post('socket-ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mint a short-lived ticket for the notification socket' })
  socketTicket(@CurrentUser() actor: AuthenticatedUser) {
    return this.tickets.issue(actor.id, actor.role);
  }

  @Get()
  @ApiOperation({ summary: 'The caller’s notifications, newest first' })
  feed(
    @Query(zodPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.notifications.feed(actor.id, query);
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark some or all notifications as read' })
  markRead(
    @Body(zodPipe(markNotificationsReadSchema)) body: MarkNotificationsReadInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.notifications.markRead(actor.id, body);
  }
}
