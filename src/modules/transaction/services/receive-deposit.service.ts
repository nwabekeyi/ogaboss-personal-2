// src/transactions/deposit.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { TransactionService } from './transaction.service';
import { DepositAddressDto } from '../dto';

@Injectable()
export class DepositService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
  ) {}

  async getDepositAddress(userId: string, dto: DepositAddressDto) {
    const { currency, network } = dto;

    if (!currency) {
      throw new BadRequestException('Currency is required');
    }

    // Normalize
    const currencyUpper = currency.toUpperCase();
    const networkUpper = network ? network.toUpperCase() : undefined;

    await this.transactionService.validateNetworkExists(
      userId,
      currencyUpper,
      networkUpper,
    );

    const wallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        currency: { equals: currencyUpper, mode: 'insensitive' },
      },
      include: { paymentAddresses: true },
    });

    if (!wallet) {
      throw new NotFoundException(`No wallet found for ${currency}`);
    }

    // Filter out arbitrum and lsk networks which are not supported
    const EXCLUDED_NETWORKS = ['arbitrum', 'lsk'];
    let paymentAddress = wallet.paymentAddresses
      .filter((addr) => !EXCLUDED_NETWORKS.includes(addr.network?.toLowerCase() ?? ''))
      .find((addr) => addr.network?.toUpperCase() === networkUpper);

    if (!paymentAddress || !paymentAddress.address) {
      throw new BadRequestException(
        `No deposit address available for ${currency} on ${network || 'default'} network. Please contact support.`,
      );
    }

    return {
      success: true,
      message: 'Use this address to deposit funds',
      data: {
        currency: currencyUpper,
        network: paymentAddress.network || wallet.defaultNetwork || 'default',
        address: paymentAddress.address,
        destinationTag: paymentAddress.destinationTag || null,
        memoNote: paymentAddress.destinationTag
          ? 'Important: You MUST include this destination tag/memo when sending, or funds may be lost.'
          : null,
      },
    };
  }
}