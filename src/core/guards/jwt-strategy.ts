import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { config } from '../../config';
import { AdminService } from '../../modules/auth/admin';
import { UserService } from '../../modules/auth/users/users.service';
import { UserType } from '../../infrastructure';


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly adminService: AdminService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.credentials.jwt.accessSecret,
    });
  }

  async validate(payload: any) {
    const { sub: userId, userType } = payload;

    if (!userId || !userType) {
      throw new UnauthorizedException();
    }

    let user;

    switch (userType) {
      case UserType.ADMIN:
        user = await this.adminService.findAdminById(userId);
        break;

      case UserType.INDIVIDUAL:
      case UserType.CORPORATE:
        user = await this.userService.findUserById(userId);
        break;

      default:
        throw new UnauthorizedException();
    }

    if (!user) {
      throw new UnauthorizedException();
    }

    /**
     * This object becomes req.user
     */
    return {
      id: user.id,
      role: user.role,
      userType: user.userType,
      internalRoleId: user.internalRoleId ?? null,
      accountStatus: user.accountStatus
    };
  }
}