import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api/server';
import { socketUrl } from '@/lib/config/env';

interface Ticket {
  ticket: string;
  expiresIn: number;
}

/**
 * Mints a one-shot ticket for the notification socket.
 *
 * A route handler of its own rather than a call through `/api/bff`, because
 * the browser needs one more thing than the API returns: *where* to connect.
 * That address is server configuration, and this is the only place it is
 * disclosed — the access token stays here, as it always has.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const result = await apiFetch<Ticket>('/notifications/socket-ticket', { method: 'POST' });

    return NextResponse.json(
      { url: socketUrl, ...result.data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // No session, or the API is down. Either way the bell falls back to
    // fetching on its own; a socket is an optimisation, not a dependency.
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
}
