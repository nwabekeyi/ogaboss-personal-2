import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { GetAdminUsersDto, FlagUserDto, GetAdminTransactionsDto } from '../dto';
import { Status } from '../../../infrastructure';
import {
  BASE_CURRENCY,
  TransactionFormatter,
  ConvertCurrency,
  toBigInt,
} from '../../../shared';

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllUsers(dto: GetAdminUsersDto = {}) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      kycStatus,
      emailVerified,
      country,
    } = dto;

    if (page < 1) throw new BadRequestException('Page must be >= 1');
    if (limit < 1 || limit > 100)
      throw new BadRequestException('Limit must be between 1 and 100');

    const skip = (page - 1) * limit;

    const where: any = { status: { not: Status.DELETED } };

    if (status) where.status = status;
    if (kycStatus) where.kycVerificationStatus = kycStatus;
    if (emailVerified !== undefined)
      where.isEmailVerified = emailVerified === 'true';
    if (country) where.country = { equals: country, mode: 'insensitive' };

    if (search) {
      const term = search.trim();
      const words = term.split(' ').filter(Boolean);

      where.OR = [
        { id: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phoneNumber: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { quidaxAccountId: { contains: term, mode: 'insensitive' } },
        ...(words.length > 1
          ? [
              {
                AND: [
                  { firstName: { contains: words[0], mode: 'insensitive' } },
                  { lastName: { contains: words[1], mode: 'insensitive' } },
                ],
              },
              {
                AND: [
                  { lastName: { contains: words[0], mode: 'insensitive' } },
                  { firstName: { contains: words[1], mode: 'insensitive' } },
                ],
              },
            ]
          : []),
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNumber: true,
          quidaxAccountId: true,
          createdAt: true,
          gender: true,
          status: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const formattedUsers = users.map((user) => ({
      userId: user.id,
      accountName:
        `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A',
      walletAddress: user.quidaxAccountId || 'N/A',
      email: user.email,
      phoneNumber: user.phoneNumber || 'N/A',
      joinedDate: user.createdAt,
      gender:
        user.gender === 'MALE' ? 'M' : user.gender === 'FEMALE' ? 'F' : 'N/A',
      status: user.status,
    }));

    return {
      success: true,
      data: formattedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        quidaxAccountId: true,
        createdAt: true,
        gender: true,
        status: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      success: true,
      data: {
        userId: user.id,
        accountName:
          `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A',
        walletAddress: user.quidaxAccountId || 'N/A',
        email: user.email,
        phoneNumber: user.phoneNumber || 'N/A',
        joinedDate: user.createdAt,
        gender:
          user.gender === 'MALE' ? 'M' : user.gender === 'FEMALE' ? 'F' : 'N/A',
        status: user.status,
      },
    };
  }

  async flagUser(adminId: string, userId: string, dto: FlagUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === Status.DELETED) {
      throw new BadRequestException('Cannot flag a deleted user');
    }

    if (user.status === Status.FLAGGED) {
      throw new BadRequestException('User is already flagged');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: Status.FLAGGED,
        flaggedReason: dto.reason.trim(),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        flaggedReason: true,
      },
    });

    return {
      success: true,
      message: 'User has been flagged',
      data: {
        userId: updatedUser.id,
        accountName:
          `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() ||
          'N/A',
        email: updatedUser.email,
        status: updatedUser.status,
        flaggedReason: updatedUser.flaggedReason,
      },
    };
  }

  async unflagUser(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== Status.FLAGGED) {
      throw new BadRequestException('User is not flagged');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: Status.ACTIVE,
        flaggedReason: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        flaggedReason: true,
      },
    });

    return {
      success: true,
      message: 'User has been unflagged',
      data: {
        userId: updatedUser.id,
        accountName:
          `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() ||
          'N/A',
        email: updatedUser.email,
        status: updatedUser.status,
        flaggedReason: updatedUser.flaggedReason,
      },
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        country: true,
        residentialAddress: true,
        dateOfBirth: true,
        gender: true,
        createdAt: true,
        status: true,
        flaggedReason: true,
        quidaxAccountId: true,
        amountSent: true,
        amountReceived: true,
        amountBought: true,
        amountSold: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    // Total transaction in NGN
    const totalTransactions =
      toBigInt(user.amountSent) +
      toBigInt(user.amountReceived) +
      toBigInt(user.amountBought) +
      toBigInt(user.amountSold);

    return {
      success: true,
      data: {
        userId: user.id,
        accountName:
          `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A',
        email: user.email,
        phoneNumber: user.phoneNumber || 'N/A',
        country: user.country || 'N/A',
        residentialAddress: user.residentialAddress || 'N/A',
        dateOfBirth: user.dateOfBirth
          ? user.dateOfBirth.toISOString().split('T')[0]
          : 'N/A',
        gender: user.gender || 'N/A',
        joinedDate: user.createdAt.toISOString().split('T')[0],
        status: user.status,
        flaggedReason: user.flaggedReason || null,
        walletAddress: user.quidaxAccountId,
        transactionSummary: {
          totalTransactions: ConvertCurrency.fromBase(
            totalTransactions,
            BASE_CURRENCY,
          ),
          amountSent: ConvertCurrency.fromBase(user.amountSent, BASE_CURRENCY),
          amountReceived: ConvertCurrency.fromBase(
            user.amountReceived,
            BASE_CURRENCY,
          ),
          amountBought: ConvertCurrency.fromBase(
            user.amountBought,
            BASE_CURRENCY,
          ),
          amountSold: ConvertCurrency.fromBase(user.amountSold, BASE_CURRENCY),
        },
      },
    };
  }

  /**
   * Get user's full transaction history (paginated)
   */
  async getUserTransactionHistory(
    userId: string,
    dto: GetAdminTransactionsDto = {},
  ) {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      context,
      currency,
      startDate,
      endDate,
      search,
    } = dto;

    if (page < 1) throw new BadRequestException('Page must be >= 1');
    if (limit < 1 || limit > 100)
      throw new BadRequestException('Limit must be between 1 and 100');

    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (status) where.status = status;
    if (type) where.transactionType = type;
    if (context) where.transactionContext = context;
    if (currency) where.currency = { equals: currency, mode: 'insensitive' };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { id: { contains: term, mode: 'insensitive' } },
        { transactionUniqueId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          User: {
            select: { firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const formattedData = TransactionFormatter.formatMany(transactions);

    return {
      success: true,
      data: formattedData,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}