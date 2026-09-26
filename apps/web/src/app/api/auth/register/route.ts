import { NextResponse, type NextRequest } from 'next/server';
import { registerSchema } from '@dtrace/shared';
import { authenticateUpstream } from '@/lib/auth/authenticate';
import { writeSessionCookies } from '@/lib/auth/session';

/**
 * Self-service registration. Identical token handling to sign-in.
 *
 * The browser posts here, this handler talks to the API, and the tokens stop
 * at this process: the response body carries the user profile only. Nothing
 * that can authenticate a request is ever serialised to the client.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const json = await request.json().catch(() => null);

  // Validate before leaving the process: the same schema the API enforces, so
  // an obviously bad form never costs an upstream round trip.
  const parsed = registerSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  const result = await authenticateUpstream(
    '/auth/register',
    parsed.data,
    request.headers.get('x-forwarded-for'),
  );

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  await writeSessionCookies(result);

  return NextResponse.json({ success: true, data: { user: result.user } });
}
