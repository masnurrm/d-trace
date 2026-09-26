'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { NotificationFeed } from '@dtrace/shared';

interface TicketResponse {
  url: string;
  ticket: string;
  expiresIn: number;
}

/**
 * Keeps the notification feed live over a socket.
 *
 * The browser has no access token, so it cannot authenticate a handshake the
 * way an HTTP call does. Instead it asks this app's server for a one-shot
 * ticket — minted with the token, server-side — and presents that. A ticket is
 * worth one connection for one minute and nothing over HTTP, which is why it
 * is safe to hand to a browser when a token would not be.
 *
 * A fresh ticket is fetched for every connection attempt, including every
 * reconnect: a spent ticket cannot be replayed, and a stale one has expired
 * long before the socket gets around to retrying.
 */
export function useNotificationSocket(): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function connect() {
      if (cancelled) return;

      let ticket: TicketResponse;
      try {
        const response = await fetch('/api/socket-ticket', {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('no ticket');
        ticket = (await response.json()) as TicketResponse;
      } catch {
        // No session, or the app is unreachable. Back off and try again — the
        // list still works, it simply stops updating by itself.
        schedule();
        return;
      }

      if (cancelled) return;

      const socket = io(`${ticket.url}/notifications`, {
        auth: { ticket: ticket.ticket },
        transports: ['websocket'],
        // Reconnection is handled here, not by socket.io: its own retry would
        // reuse the spent ticket and be refused every time.
        reconnection: false,
        withCredentials: true,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        setConnected(true);

        // The backoff resets only once the connection has *held*. Resetting it
        // on 'connect' looks equivalent and is not: a socket the server accepts
        // and then drops — a refused origin, a proxy idle timeout, a ticket
        // that lost a race — fires connect before disconnect, so the counter
        // went back to zero every time and the retry never got past two
        // seconds. That is a ticket request every two seconds, forever.
        settleTimer = setTimeout(() => {
          attempt = 0;
        }, 10_000);
      });

      socket.on('feed', (feed: NotificationFeed) => {
        // The server sends the whole feed, so the cache is replaced rather
        // than invalidated — the bell updates without a round trip.
        queryClient.setQueryData(['notifications'], { data: feed });
      });

      const drop = () => {
        setConnected(false);
        if (settleTimer) clearTimeout(settleTimer);
        socket.removeAllListeners();
        socket.close();
        if (socketRef.current === socket) socketRef.current = null;
        schedule();
      };

      socket.on('disconnect', drop);
      socket.on('connect_error', drop);
    }

    /** Exponential backoff, capped: a dead API must not become a hot loop. */
    function schedule() {
      if (cancelled) return;
      attempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
      retryTimer = setTimeout(connect, delay);
    }

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (settleTimer) clearTimeout(settleTimer);
      socketRef.current?.removeAllListeners();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [queryClient]);

  return { connected };
}
