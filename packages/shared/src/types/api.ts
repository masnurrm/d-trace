import type { ErrorCode } from '../constants/errors.js';
import type { PaginationMeta } from '../schemas/common.schema.js';

/**
 * Every API response uses one of these two envelopes. The web `apiFetch`
 * helper narrows on `success`, so a caller cannot read `data` without having
 * handled the error branch first.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  /** Correlates a response with its server log line. */
  requestId: string;
  timestamp: string;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: ErrorCode | string;
    message: string;
    /** Present for VALIDATION_FAILED; safe to surface next to form inputs. */
    details?: ApiFieldError[];
  };
  requestId: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccess<T> {
  return response.success === true;
}
