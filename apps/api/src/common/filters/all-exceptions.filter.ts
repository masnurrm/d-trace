import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES, type ApiError, type ApiFieldError } from '@dtrace/shared';
import { Prisma } from '../../generated/prisma/client.js';
import type { AppExceptionBody } from '../exceptions/app.exception.js';
import { getRequestId, type AuthenticatedRequest } from '../types/authenticated-request.js';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: ApiFieldError[];
}

/**
 * The single place an error becomes an HTTP response.
 *
 * Two rules: the client always receives the `ApiError` envelope, and an
 * unexpected error never leaks its message, stack or SQL — that detail goes to
 * the server log, keyed by the same `requestId` the client is shown.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<AuthenticatedRequest>();
    const requestId = getRequestId(request);

    const normalized = this.normalize(exception);

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { requestId, path: request.url, method: request.method, err: exception },
        'Unhandled exception',
      );
    }

    const body: ApiError = {
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
      requestId,
      timestamp: new Date().toISOString(),
    };

    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const body = payload as AppExceptionBody;
        return { status, code: body.code, message: body.message, details: body.details };
      }

      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: statusToCode(status),
        message: Array.isArray(message) ? message.join(', ') : message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.normalizePrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // A malformed query is our bug, not the caller's — say nothing specific.
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The request could not be processed',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong. Quote the request id when reporting this.',
    };
  }

  private normalizePrisma(error: Prisma.PrismaClientKnownRequestError): NormalizedError {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          // Field names are safe to echo; values are not.
          message: `A record with this ${fieldsOf(error).join(', ') || 'value'} already exists`,
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Resource not found',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'Related record is missing or still in use',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Database request failed',
        };
    }
  }
}

function fieldsOf(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.filter((item): item is string => typeof item === 'string');
  return typeof target === 'string' ? [target] : [];
}

function statusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ERROR_CODES.PAYLOAD_TOO_LARGE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
  }
}
