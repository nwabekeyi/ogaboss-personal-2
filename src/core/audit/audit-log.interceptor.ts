import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import {
  AuditActorType,
  AuditStatus,
} from '../../infrastructure/databases/prisma/generated/prisma/client';
import { AuthenticatedRequest } from '../../common';
import { AuditLogService } from './audit-log.service';
import {
  AUDIT_LOG_METADATA,
  AuditLogOptions,
} from './decorators/audit-log.decorator';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditOptions = this.reflector.getAllAndOverride<AuditLogOptions>(
      AUDIT_LOG_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!auditOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestId =
      (request.headers['x-request-id'] as string) ??
      ((request as any).id as string) ??
      undefined;
    const actorId = request.user?.id;
    const actorType = this.resolveActorType(request);
    const maskFields = new Set<string>([
      'pin',
      'newPin',
      'currentPin',
      'otp',
      'token',
      'password',
      'authorization',
      ...(auditOptions.maskFields ?? []),
    ]);
    const contextSnapshot = {
      method: request.method,
      path: request.path,
      params: request.params,
      query: request.query,
      body: this.sanitizePayload(request.body, maskFields),
    };

    const resourceId =
      this.resolvePath(request, auditOptions.resourceIdPath) ?? undefined;

    return next.handle().pipe(
      tap((response) => {
        void this.auditLogService.record({
          action: auditOptions.action,
          resource: auditOptions.resource,
          resourceId,
          actorId,
          actorType,
          requestId,
          ipAddress: this.getClientIp(request),
          userAgent: (request.headers['user-agent'] as string) ?? undefined,
          context: {
            ...contextSnapshot,
            response: auditOptions.includeResponseBody
              ? this.truncateResponse(response)
              : undefined,
          },
          status: AuditStatus.SUCCESS,
        });
      }),
      catchError((error) => {
        void this.auditLogService.record({
          action: auditOptions.action,
          resource: auditOptions.resource,
          resourceId,
          actorId,
          actorType,
          requestId,
          ipAddress: this.getClientIp(request),
          userAgent: (request.headers['user-agent'] as string) ?? undefined,
          context: contextSnapshot,
          status: AuditStatus.FAILURE,
          error: error?.message ?? 'Unknown error',
        });

        return throwError(() => error);
      }),
    );
  }

  private sanitizePayload(payload: any, maskFields: Set<string>): any {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.sanitizePayload(item, maskFields));
    }

    const clone: Record<string, any> = {};
    for (const key of Object.keys(payload)) {
      const value = payload[key];
      if (maskFields.has(key)) {
        clone[key] = '[REDACTED]';
        continue;
      }

      if (value && typeof value === 'object') {
        clone[key] = this.sanitizePayload(value, maskFields);
      } else {
        clone[key] = value;
      }
    }

    return clone;
  }

  private resolveActorType(request: AuthenticatedRequest): AuditActorType {
    if (request.user?.role) {
      return AuditActorType.ADMIN;
    }

    if (request.user?.id) {
      return AuditActorType.USER;
    }

    return AuditActorType.UNKNOWN;
  }

  private resolvePath(
    request: AuthenticatedRequest,
    path?: string,
  ): string | undefined {
    if (!path) {
      return undefined;
    }

    const segments = path.split('.');
    let current: any = this.getPathRoot(request, segments.shift()!);
    for (const segment of segments) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[segment];
    }

    return typeof current === 'string'
      ? current
      : current !== undefined
        ? String(current)
        : undefined;
  }

  private getPathRoot(request: AuthenticatedRequest, root: string) {
    switch (root) {
      case 'body':
        return request.body;
      case 'params':
        return request.params;
      case 'query':
        return request.query;
      case 'user':
        return request.user;
      default:
        return (request as any)[root];
    }
  }

  private getClientIp(request: AuthenticatedRequest): string | undefined {
    const forwarded = request.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    return request.ip ?? request.socket?.remoteAddress ?? undefined;
  }

  private truncateResponse(response: any) {
    if (response === null || response === undefined) {
      return response;
    }

    try {
      const json = JSON.parse(JSON.stringify(response));
      const serialized = JSON.stringify(json);
      if (serialized.length > 2000) {
        return '[TRUNCATED_RESPONSE]';
      }
      return json;
    } catch (error) {
      this.logger.warn('Unable to serialize response for audit logging');
      return undefined;
    }
  }
}
