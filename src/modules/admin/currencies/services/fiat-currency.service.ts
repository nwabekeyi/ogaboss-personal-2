import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import { Prisma } from '../../../../infrastructure';
import { PaginationService } from '../../../../shared';
import currencyCodes from 'currency-codes';
import { GetAllFiatsOptions } from '../../types';
import { CreateFiatDto, PatchFiatDto } from '../../dto';

@Injectable()
export class FiatCurrencyService {
  constructor(private readonly prisma: PrismaService) {}


  private validateCurrency(code: string, name: string) {
    const currency = currencyCodes.code(code.toUpperCase());
    if (!currency) {
      throw new BadRequestException(`Unsupported currency code: ${code.toUpperCase()}`);
    }

    if (currency.currency.toLowerCase() !== name.toLowerCase()) {
      throw new BadRequestException(
        `Currency name does not match code`
      );
    }

    return currency;
  }


  private getDecimals(code: string): number {
    const currency = currencyCodes.code(code.toUpperCase());
    if (!currency) throw new BadRequestException(`Unsupported currency code: ${code}`);
    return currency.digits;
  }


  async getAllFiatOptions(search?: string) {
    const term = search?.toLowerCase();

    const allCurrencies = currencyCodes.data
      .filter((c) => {
        if (!term) return true;
        return c.code.toLowerCase().includes(term) || c.currency.toLowerCase().includes(term);
      })
      .map((c) => ({
        code: c.code,
        name: c.currency,
        decimals: c.digits,
        countries: c.countries,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    return {
      success: true,
      message: 'Available fiat currencies retrieved successfully',
      data: allCurrencies,
    };
  }


  async getAllFiats(options: GetAllFiatsOptions = {}) {
    const { search, page, pageSize } = options;

    const where: Prisma.FiatCurrencyWhereInput = {};

    if (search) {
      const term = search.toLowerCase();
      where.OR = [
        { code: { contains: term } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }

    const shouldPaginate = page !== undefined && pageSize !== undefined;

    // Count only when paginating
    const itemsCount = shouldPaginate
      ? await this.prisma.fiatCurrency.count({ where })
      : undefined;

    const fiats = await this.prisma.fiatCurrency.findMany({
      where,
      ...(shouldPaginate && {
        skip: (page! - 1) * pageSize!,
        take: pageSize!,
      }),
    });

    const sorted = fiats.sort((a, b) => {
      if (a.code.toLowerCase() === 'usd') return -1;
      if (b.code.toLowerCase() === 'usd') return 1;
      return a.code.localeCompare(b.code);
    });

    const data = sorted.map((f) => {
      const decimals = this.getDecimals(f.code);
      return {
        id: f.id,
        code: f.code.toUpperCase(),
        name: f.name,
        symbol: f.symbol,
        decimals,
      };
    });

    return {
      success: true,
      message: 'Fiat currencies retrieved successfully',
      data,
      ...(shouldPaginate && {
        pagination: PaginationService.getPagination(
          page!,
          pageSize!,
          itemsCount!,
        ),
      }),
    };
  }


  async createFiat(dto: CreateFiatDto) {
    const { code, name, symbol } = dto;

    const currency = this.validateCurrency(code, name);

    const decimals = currency.digits;

    const existing = await this.prisma.fiatCurrency.findUnique({ where: { code: code.toLowerCase() } });
    if (existing) {
      throw new ConflictException(`Fiat currency ${code.toUpperCase()} already exists`);
    }

    const fiat = await this.prisma.fiatCurrency.create({
      data: {
        code: code.toLowerCase(),
        name: currency.currency,
        symbol: symbol || null,
      },
    });

    return {
      success: true,
      message: `Fiat currency ${code.toUpperCase()} created successfully`,
      data: {
        id: fiat.id,
        code: fiat.code.toUpperCase(),
        name: fiat.name,
        symbol: fiat.symbol,
        decimals,
      },
    };
  }


  async patchFiat(fiatId: string, dto: PatchFiatDto) {
    const fiat = await this.prisma.fiatCurrency.findUnique({ where: { id: fiatId } });
    if (!fiat) throw new NotFoundException('Fiat currency not found');

    if (fiat.code.toLowerCase() === 'usd') {
      throw new BadRequestException('USD cannot be modified');
    }

    const decimals = this.getDecimals(fiat.code);
    const updateData: Prisma.FiatCurrencyUpdateInput = {};

    if (dto.name !== undefined) {
      this.validateCurrency(fiat.code, dto.name);
      updateData.name = dto.name;
    }

    if (dto.symbol !== undefined) {
      updateData.symbol = dto.symbol;
    }

    const updated = await this.prisma.fiatCurrency.update({
      where: { id: fiatId },
      data: updateData,
    });

    return {
      success: true,
      message: `Fiat currency ${updated.code.toUpperCase()} updated successfully`,
      data: {
        id: updated.id,
        code: updated.code.toUpperCase(),
        name: updated.name,
        symbol: updated.symbol,
        decimals,
      },
    };
  }
}
