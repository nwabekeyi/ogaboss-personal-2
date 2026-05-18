import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Role } from '../../common/enums/roles.enum';
import { UserType } from '../../infrastructure';
import { IS_PUBLIC_KEY } from './public.decorator';

export function Auth(roles?: Role[], userTypes?: UserType[]) {
  return applyDecorators(
    SetMetadata(IS_PUBLIC_KEY, false),
    UseGuards(JwtAuthGuard, RolesGuard),
    SetMetadata('roles', roles || []),
    SetMetadata('userTypes', userTypes || []),
  );
}
