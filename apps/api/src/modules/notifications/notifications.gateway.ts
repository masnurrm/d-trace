import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { NotificationFeed } from '@dtrace/shared';
import type { AppConfig } from '../../config/configuration.js';
import { SocketTicketService } from './socket-ticket.service.js';

/** One room per person. A notification is addressed, never broadcast. */
const roomFor = (userId: string) => `user:${userId}`;

/**
 * The notification socket.
 *
 * This is the one place the browser talks to the API directly, and it is
 * deliberately the narrowest possible opening: the only thing a connected
 * socket can do is *receive* notifications addressed to the account that
 * opened it. There is no client-to-server message handler at all, so there is
 * no surface here to send anything to.
 *
 * Authentication is by one-shot ticket rather than by token, because the
 * browser has no token — see `SocketTicketService` for why that matters.
 */
@WebSocketGateway({
  namespace: '/notifications',
  // Same origin allow-list the HTTP side uses. A socket bypasses the origin
  // middleware, so it has to be told the same thing separately.
  cors: { origin: true, credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly tickets: SocketTicketService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  handleConnection(client: Socket): void {
    const ticket = client.handshake.auth?.['ticket'];
    const redeemed = this.tickets.redeem(typeof ticket === 'string' ? ticket : undefined);

    if (!redeemed) {
      // No error detail: an unauthenticated socket learns only that it failed.
      client.disconnect(true);
      return;
    }

    const origin = client.handshake.headers.origin;
    if (origin && !this.isAllowedOrigin(origin)) {
      this.logger.warn(`Refused notification socket from origin ${origin}`);
      client.disconnect(true);
      return;
    }

    client.data['userId'] = redeemed.userId;
    void client.join(roomFor(redeemed.userId));
  }

  handleDisconnect(client: Socket): void {
    // Socket.IO leaves the rooms itself; nothing to unwind. The hook exists so
    // the lifecycle is stated rather than implied.
    client.data['userId'] = undefined;
  }

  /**
   * Pushes a fresh feed to one person.
   *
   * The whole feed rather than the single new row: the bell shows a count and
   * a list, and sending the row alone would leave the client to recompute the
   * count — which is how two tabs end up disagreeing about how many are unread.
   */
  emitFeed(userId: string, feed: NotificationFeed): void {
    // The server is undefined until Nest has initialised the adapter; a
    // notification written during boot is simply not pushed, and the next
    // fetch picks it up.
    this.server?.to(roomFor(userId)).emit('feed', feed);
  }

  private isAllowedOrigin(origin: string): boolean {
    const allowed = this.config.get('corsOrigins', { infer: true });
    // An empty allow-list means the deployment has not restricted origins;
    // that is the HTTP side's decision too, so the socket follows it rather
    // than inventing a stricter rule of its own.
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(origin);
  }
}
