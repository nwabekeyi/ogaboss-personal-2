import { UserType, AdminRole } from '../../infrastructure/databases/prisma';
import { Request } from 'express';


export interface AuthenticatedRequest extends Request {
    user: {
      id: string;
      userType?: UserType;
      role?: AdminRole;
      internalRoleId?: string;
      accountStatus?:string
    };
  }