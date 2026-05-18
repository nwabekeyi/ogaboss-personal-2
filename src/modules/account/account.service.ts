import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
  BadRequestException,
  ConflictException,
  BadGatewayException,
} from '@nestjs/common';
import { UserService } from '../auth/users/users.service';
import { PrismaService } from '../../infrastructure';
import { PaystackService } from '../../infrastructure/providers/paystack';
import { TokenService } from '../../shared';
import {
  VerifyBankAccountDto,
  CreateBankWithTokenDto,
  updateBankAccountDTO,
} from './dto';
import {
  PaystackBankVerifyResponse,
  PaystackVerifyResponse,
} from '../../infrastructure/providers/paystack/type';
import { RedisService } from '../../infrastructure/databases/redis';
import { PaystackBank } from './type';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  constructor(
    private readonly userService: UserService,
    private readonly prismaService: PrismaService,
    private readonly paystackService: PaystackService,
    private readonly redisService: RedisService,
    private readonly tokenService: TokenService,
  ) {}

  async verifyBankAccount(
    dto: VerifyBankAccountDto,
  ): Promise<{ tempToken: string }> {
    const { accountNumber, bankCode } = dto;

    const response = (await this.paystackService.verifyBankAccount({
      account_number: accountNumber,
      bank_code: bankCode,
    })) as PaystackBankVerifyResponse;

    if (!response?.status || !response.data?.account_name) {
      this.logger.warn('Bank verification failed', {
        accountNumber,
        bankCode,
        response,
      });
      throw new BadRequestException('Unable to verify bank account');
    }

    const tempToken = await this.tokenService.generateBankVerificationToken({
      accountNumber,
      bankCode,
      accountName: response.data.account_name,
    });

    // Store in Redis for 5 minutes (extra safety)
    const redis = this.redisService.getClient();
    await redis.set(`bank_verify:${tempToken}`, '1', 'EX', 5 * 60);

    return { tempToken };
  }

   async createBankAccount(
     userId: string,
     dto: CreateBankWithTokenDto,
   ): Promise<any> {
     const { tempToken } = dto;

     const user = await this.userService.getUserById(userId);
     if (!user) throw new NotFoundException('User not found');

     const redis = this.redisService.getClient();
     const exists = await redis.exists(`bank_verify:${tempToken}`);
     if (!exists) {
       throw new UnauthorizedException('Verification token expired or invalid');
     }

     let payload: {
       accountNumber: string;
       bankCode: string;
       accountName: string;
       type: string;
       iat?: number;
       exp?: number;
     };

     try {
       payload = await this.tokenService.verifyBankVerificationToken(tempToken);
     } catch (error) {
       await redis.del(`bank_verify:${tempToken}`);
       throw error;
     }

     const { accountNumber, bankCode, accountName } = payload;
     const bankName = await this.getBankNameFromCode(bankCode);

     // ── VALIDATE ACCOUNT NAME MATCHES USER'S REGISTERED NAME ──
     const normalizedAccountName = accountName.trim().toLowerCase();
     const normalizedUserFirstName = (user.firstName || '').trim().toLowerCase();
     const normalizedUserLastName = (user.lastName || '').trim().toLowerCase();

     // Build the expected full name from user's first and last name
     const expectedFullName = `${normalizedUserFirstName} ${normalizedUserLastName}`.trim();

     // Check if the bank account name matches the user's name
     // Allow some flexibility: either exact match or account name contains both first and last name
     const nameMatches =
       normalizedAccountName === expectedFullName ||
       (normalizedAccountName.includes(normalizedUserFirstName) &&
        normalizedAccountName.includes(normalizedUserLastName));

     if (!nameMatches) {
       await redis.del(`bank_verify:${tempToken}`);
       throw new BadRequestException(
         `Bank account name verification failed. Please ensure the bank account belongs to you.`,
       );
     }

     const existing = await this.prismaService.userBankAccount.findFirst({
       where: { userId, bankAccountNumber: accountNumber },
     });

     if (existing) {
       await redis.del(`bank_verify:${tempToken}`);
       throw new ConflictException('This bank account is already added');
     }

     const bankAccount = await this.prismaService.userBankAccount.create({
       data: {
         userId,
         bankName,
         bankAccountName: accountName,
         bankAccountNumber: accountNumber,
         bankCode,
       },
     });

     await redis.del(`bank_verify:${tempToken}`);

     return {
       message: 'Bank account added successfully',
       bankAccount,
     };
   }

  private async getBankNameFromCode(bankCode: string): Promise<string> {
    const redis = this.redisService.getClient();
    let banks: PaystackBank[] = [];

    const cached = await redis.get('paystack:banks');
    if (cached) {
      banks = JSON.parse(cached) as PaystackBank[];
    } else {
      // Properly type the Paystack listBanks() response
      const response = await this.paystackService.listBanks();

      // Safe access with type assertion only when we know the shape
      if (
        response &&
        typeof response === 'object' &&
        'data' in response &&
        Array.isArray(response.data)
      ) {
        banks = response.data as PaystackBank[];
      }

      await redis.set(
        'paystack:banks',
        JSON.stringify(banks),
        'EX',
        24 * 60 * 60,
      );
    }

    const bank = banks.find((b) => b.code === bankCode);
    if (!bank) {
      throw new BadRequestException('Invalid bank code');
    }

    return bank.name;
  }

  async allBanks(search?: string): Promise<any> {
    const redis = this.redisService.getClient();
    const cachedBanks = await redis.get('paystack:banks');
    let banks = [];
    if (cachedBanks) {
      banks = JSON.parse(cachedBanks);
    } else {
      const response = (await this.paystackService.listBanks()) as any;
      banks = response.data || [];
      await redis.set(
        'paystack:banks',
        JSON.stringify(banks),
        'EX',
        60 * 60 * 24,
      );
    }

    let filteredBanks = banks.map((bank: any) => ({
      name: bank.name,
      code: bank.code,
    }));

    if (search) {
      const searchLower = search.toLowerCase();
      filteredBanks = filteredBanks.filter(
        (bank: any) =>
          bank.name.toLowerCase().includes(searchLower) ||
          bank.code.includes(search),
      );
    }

    return {
      message: 'Banks retrieved successfully',
      data: filteredBanks,
    };
  }

  async getBankAccounts(userId: string): Promise<any> {
    const bankAccount = await this.prismaService.userBankAccount.findMany({
      where: { userId },
    });
    return {
      message: 'Bank accounts retrieved successfully',
      bankAccount,
    };
  }

  async getBankAccountById(
    userId: string,
    bankAccountId: string,
  ): Promise<any> {
    return this.prismaService.userBankAccount.findFirst({
      where: { userId, id: bankAccountId },
    });
  }

  async deleteBankAccount(userId: string, bankAccountId: string): Promise<any> {
    const user = await this.userService.getUserById(userId);
    if (!user) throw new NotFoundException('User not found');

    return this.prismaService.userBankAccount.delete({
      where: { id: bankAccountId },
    });
  }

  async getBankAccountByAccountNumber(bankAccountNumber: string): Promise<any> {
    return this.prismaService.userBankAccount.findFirst({
      where: { bankAccountNumber },
    });
  }

  async getBankAccountByAccountName(bankAccountName: string): Promise<any> {
    return this.prismaService.userBankAccount.findFirst({
      where: { bankAccountName },
    });
  }

  async getBankAccountByBankName(bankName: string): Promise<any> {
    return this.prismaService.userBankAccount.findFirst({
      where: { bankName },
    });
  }
}
