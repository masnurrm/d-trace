import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ApiFieldError, type ErrorCode } from '@dtrace/shared';

export interface AppExceptionBody {
  code: ErrorCode | string;
  message: string;
  details?: ApiFieldError[];
}

/**
 * Every deliberate failure in the app is an AppException, so responses always
 * carry a stable `code`. Throwing a bare `HttpException` still works — the
 * global filter maps it onto a best-effort code — but prefer these.
 */
export class AppException extends HttpException {
  constructor(code: ErrorCode | string, message: string, status: HttpStatus, details?: ApiFieldError[]) {
    super({ code, message, details } satisfies AppExceptionBody, status);
  }

  static validation(details: ApiFieldError[], message = 'Validation failed'): AppException {
    return new AppException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthorized(message = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHORIZED) {
    return new AppException(code, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = 'You do not have access to this resource'): AppException {
    return new AppException(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static notFound(resource = 'Resource'): AppException {
    return new AppException(ERROR_CODES.NOT_FOUND, `${resource} not found`, HttpStatus.NOT_FOUND);
  }

  static conflict(message: string): AppException {
    return new AppException(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT);
  }

  /**
   * Login failures never say *which* half was wrong: distinguishing "no such
   * user" from "wrong password" turns the endpoint into an account enumerator.
   */
  static invalidCredentials(): AppException {
    return new AppException(
      ERROR_CODES.INVALID_CREDENTIALS,
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
