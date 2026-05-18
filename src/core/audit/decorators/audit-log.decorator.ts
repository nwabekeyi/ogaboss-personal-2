import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditResource } from '../type';

export const AUDIT_LOG_METADATA = 'audit_log_metadata';

export interface AuditLogOptions {
  action: AuditAction;
  resource?: AuditResource;
  resourceIdPath?: string;
  maskFields?: string[];
  includeResponseBody?: boolean;
}

export const AuditLog = (options: AuditLogOptions) =>
  SetMetadata(AUDIT_LOG_METADATA, options);
