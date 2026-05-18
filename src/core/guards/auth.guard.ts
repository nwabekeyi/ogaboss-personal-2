import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ErrorMessages } from '../../shared';
import { AuthenticatedRequest } from '../../common';
import { config } from '../../config';
import { PrismaService, Status, UserType } from '../../infrastructure';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException(ErrorMessages.USER_NOT_AUTHORIZE);
    }
    // If verification fails, jwtService throws automatically — global filter catches it
    const payload = await this.jwtService.verifyAsync(token, {
      secret: config.credentials.jwt.accessSecret,
    });
    request.user = payload;

    if (payload?.userType !== UserType.ADMIN) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.id },
        select: { status: true },
      });

      if (!dbUser) {
        throw new UnauthorizedException(ErrorMessages.USER_NOT_AUTHORIZE);
      }

      if (dbUser.status === Status.FLAGGED) {
        throw new ForbiddenException('Something went wrong. Contact support.');
      }
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
