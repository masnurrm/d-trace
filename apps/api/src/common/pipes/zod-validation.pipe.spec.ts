import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { createUserSchema, loginSchema } from '@dtrace/shared';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const metadata = { type: 'body' } as const;

describe('ZodValidationPipe', () => {
  it('returns the parsed value, with schema transforms applied', () => {
    const pipe = new ZodValidationPipe(loginSchema);

    const result = pipe.transform(
      { email: '  Alice@Example.COM ', password: 'correct horse battery' },
      metadata,
    );

    expect(result).toEqual({ email: 'alice@example.com', password: 'correct horse battery' });
  });

  it('strips properties the schema does not declare', () => {
    const pipe = new ZodValidationPipe(createUserSchema);

    const result = pipe.transform(
      {
        name: 'Mallory',
        email: 'mallory@example.com',
        password: 'LongEnoughPass1',
        role: 'VIEWER',
        // A hand-crafted extra field must not survive into the Prisma call.
        isActive: true,
        id: 'attacker-chosen-id',
      },
      metadata,
    ) as Record<string, unknown>;

    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('isActive');
  });

  it('reports every failing field instead of stopping at the first', () => {
    const pipe = new ZodValidationPipe(createUserSchema);

    try {
      pipe.transform({ name: 'x', email: 'not-an-email', password: 'short' }, metadata);
      expect.unreachable('expected the pipe to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const body = (error as HttpException).getResponse() as {
        code: string;
        details: { field: string }[];
      };

      expect(body.code).toBe('VALIDATION_FAILED');
      // Each failing rule gets its own entry (password trips three at once),
      // so the form can list every reason instead of one at a time.
      const fields = body.details.map((detail) => detail.field);
      expect([...new Set(fields)].sort()).toEqual(['email', 'name', 'password']);
      expect(fields.filter((field) => field === 'password').length).toBeGreaterThan(1);
    }
  });

  it('labels the argument when the issue has no path', () => {
    const pipe = new ZodValidationPipe(z.string());

    try {
      pipe.transform(42, metadata);
      expect.unreachable('expected the pipe to throw');
    } catch (error) {
      const body = (error as HttpException).getResponse() as { details: { field: string }[] };
      expect(body.details[0]?.field).toBe('body');
    }
  });
});
