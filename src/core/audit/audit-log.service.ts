import { Injectable, Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditStatus,
} from '../../infrastructure/databases/prisma/generated/prisma/client';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { AuditAction, AuditResource } from './type';

export interface CreateAuditLogInput {
  action: AuditAction;
  resource?: AuditResource;
  resourceId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  context?: Record<string, any> | null;
  status: AuditStatus;
  error?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: CreateAuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? undefined,
          actorId: input.actorId ?? undefined,
          actorType: input.actorType ?? AuditActorType.UNKNOWN,
          requestId: input.requestId ?? undefined,
          ipAddress: input.ipAddress ?? undefined,
          userAgent: input.userAgent ?? undefined,
          context: input.context ?? undefined,
          status: input.status,
          error: input.error ?? undefined,
        },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to persist audit log entry', err.stack);
    }
  }
}
