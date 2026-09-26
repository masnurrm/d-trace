import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { ApiFieldError } from '@dtrace/shared';
import { AppException } from '../exceptions/app.exception.js';

/**
 * Validates *and coerces* a payload against a schema from @dtrace/shared, so
 * the frontend form and the backend endpoint can never drift apart.
 *
 * Because the pipe returns the parsed value, anything not described by the
 * schema is stripped — mass-assignment is impossible by construction.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: ApiFieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : (metadata.type ?? 'body'),
      message: issue.message,
    }));

    throw AppException.validation(details);
  }
}

/** Sugar: `@Body(zodPipe(loginSchema)) body: LoginInput`. */
export const zodPipe = <TSchema extends ZodType>(schema: TSchema) => new ZodValidationPipe(schema);
