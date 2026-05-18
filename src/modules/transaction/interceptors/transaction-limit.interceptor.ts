import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { TierLimitService } from '../../../shared/services/tier-limit.service';

const EXCLUDED_ROUTES = ['/buy', '/swap', '/receive', '/sell'];

@Injectable()
export class TransactionLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tierLimitService: TierLimitService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;

    if (method !== 'POST') {
      return next.handle();
    }

    const isExcluded = EXCLUDED_ROUTES.some((route) => url.includes(route));
    if (isExcluded) {
      return next.handle();
    }

    const userId = request.user.id;
    const amount = this.extractAmount(request.body);
    if (!amount || amount <= 0) {
      return next.handle();
    }

    const isValid = await this.validateLimit(userId, amount);
    if (!isValid) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tier: true },
      });
      const limit = this.tierLimitService.getLimitForTier(
        user?.tier || 'TIER_1',
      );
      throw new HttpException(
        {
          message: `Daily transfer limit exceeded. Your limit is ₦${limit.toLocaleString()} NGN per day`,
          limit,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    return next.handle().pipe(
      tap(async () => {
        await this.updateDailyTotal(userId, amount);
      }),
      catchError((error) => {
        return throwError(() => error);
      }),
    );
  }

  private extractAmount(body: any): number | null {
    if (!body) return null;

    if (typeof body.fiatAmount === 'number') return body.fiatAmount;
    if (typeof body.fiatAmount === 'string') return parseFloat(body.fiatAmount);
    if (typeof body.amount === 'number') return body.amount;
    if (typeof body.amount === 'string') return parseFloat(body.amount);

    return null;
  }

  private async validateLimit(
    userId: string,
    amount: number,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });

    const tierLimit = this.tierLimitService.getLimitForTier(
      user?.tier || 'TIER_1',
    );

    if (tierLimit.isUnlimited) {
      return true;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyTotal = await this.prisma.userDailyTransaction.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    const currentTotal = dailyTotal ? Number(dailyTotal.totalDebited) : 0;
    return currentTotal + amount <= tierLimit.dailyTransferLimit;
  }

  private async updateDailyTotal(
    userId: string,
    amount: number,
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.userDailyTransaction.upsert({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
      create: {
        userId,
        date: today,
        totalDebited: amount,
      },
      update: {
        totalDebited: {
          increment: amount,
        },
      },
    });
  }
}
