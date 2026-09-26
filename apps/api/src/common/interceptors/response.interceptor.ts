import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { ApiSuccess, PaginationMeta } from '@dtrace/shared';
import { getRequestId, type AuthenticatedRequest } from '../types/authenticated-request.js';

function isPaginated(value: unknown): value is { items: unknown[]; meta: PaginationMeta } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { meta?: unknown }).meta === 'object'
  );
}

/**
 * Wraps every successful handler return value in the `ApiSuccess` envelope so
 * the web client has exactly one response shape to parse. Controllers keep
 * returning plain objects; `{ items, meta }` is lifted into `data` + `meta`.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<unknown>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestId = getRequestId(request);

    return next.handle().pipe(
      map((payload) => {
        const timestamp = new Date().toISOString();

        if (isPaginated(payload)) {
          return { success: true, data: payload.items, meta: payload.meta, requestId, timestamp };
        }
        return { success: true, data: payload ?? null, requestId, timestamp };
      }),
    );
  }
}
