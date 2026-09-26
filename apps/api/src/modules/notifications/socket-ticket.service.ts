import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Role } from '@dtrace/shared';

interface Ticket {
  userId: string;
  role: Role;
  expiresAt: number;
}

/** A ticket is worth a single handshake, and only for the next minute. */
const TTL_MS = 60_000;

/**
 * One-shot credentials for the notification socket.
 *
 * The browser never holds an access token — that is the whole point of the BFF
 * — so it cannot authenticate a WebSocket handshake the way an HTTP call does.
 * Instead the BFF, which *does* hold the token, asks for a ticket server-side
 * and hands only that to the browser.
 *
 * What makes it safe to expose is what it cannot do: it authenticates one
 * socket connection, expires in a minute, is destroyed the moment it is used,
 * and grants nothing over HTTP. A leaked ticket is worth at most one
 * subscription to notifications the holder could already read.
 *
 * Held in memory on purpose. Tickets live for seconds, and putting them in
 * Postgres would mean a write and a delete per page load for something that
 * has no value after the handshake. The cost is that a second API instance
 * would not recognise a ticket minted by the first — when this runs behind
 * more than one process, this map becomes a Redis key with the same TTL.
 */
@Injectable()
export class SocketTicketService {
  private readonly logger = new Logger(SocketTicketService.name);
  private readonly tickets = new Map<string, Ticket>();

  issue(userId: string, role: Role): { ticket: string; expiresIn: number } {
    this.sweep();

    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { userId, role, expiresAt: Date.now() + TTL_MS });

    return { ticket, expiresIn: Math.floor(TTL_MS / 1000) };
  }

  /** Redeems a ticket, or returns null. Either way the ticket is spent. */
  redeem(ticket: string | undefined): { userId: string; role: Role } | null {
    if (!ticket) return null;

    const found = this.tickets.get(ticket);
    // Deleted even when expired: a ticket presented once is finished with,
    // and leaving a stale one behind only invites a replay attempt.
    this.tickets.delete(ticket);

    if (!found || found.expiresAt < Date.now()) return null;
    return { userId: found.userId, role: found.role };
  }

  /**
   * Drops what has expired.
   *
   * Swept on issue rather than on a timer: tickets only accumulate while
   * people are connecting, so the work happens exactly when there is work,
   * and an idle process holds no interval open.
   */
  private sweep(): void {
    if (this.tickets.size < 64) return;

    const now = Date.now();
    let dropped = 0;
    for (const [key, value] of this.tickets) {
      if (value.expiresAt < now) {
        this.tickets.delete(key);
        dropped += 1;
      }
    }

    if (dropped > 0) this.logger.debug(`Swept ${dropped} expired socket tickets`);
  }
}
