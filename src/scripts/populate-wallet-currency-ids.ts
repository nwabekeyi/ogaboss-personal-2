#!/usr/bin/env ts-node

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/databases/prisma';
import { Logger } from '@nestjs/common';

async function populateWalletCurrencyIds() {
  const logger = new Logger('PopulateWalletCurrencyIds');
  logger.log('Bootstrapping NestJS context...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  await prisma.$connect();

  logger.log('Context ready.');

  try {
    // Get all currencies to create a mapping from symbol to id
    logger.log('Fetching all currencies...');
    const currencies = await prisma.cryptoCurrency.findMany({
      select: {
        id: true,
        symbol: true,
      },
    });

    const currencyMap = new Map<string, string>();
    currencies.forEach(currency => {
      currencyMap.set(currency.symbol.toLowerCase(), currency.id);
    });

    logger.log(`Found ${currencies.length} currencies`);

    // Get all wallets that don't have currencyId set
    logger.log('Finding wallets without currencyId...');
    const walletsWithoutCurrencyId = await prisma.wallet.findMany({
      where: {
        currencyId: null,
      },
      select: {
        id: true,
        currency: true,
      },
    });

    logger.log(`Found ${walletsWithoutCurrencyId.length} wallets without currencyId`);

    // Update each wallet with the correct currencyId
    let updatedCount = 0;
    let notFoundCount = 0;

    for (const wallet of walletsWithoutCurrencyId) {
      const currencyId = currencyMap.get(wallet.currency.toLowerCase());

      if (currencyId) {
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: {
            currencyId: currencyId,
          },
        });
        updatedCount++;
        logger.log(`Updated wallet ${wallet.id} (${wallet.currency}) with currencyId ${currencyId}`);
      } else {
        notFoundCount++;
        logger.warn(`No currency found for wallet ${wallet.id} with currency ${wallet.currency}`);
      }
    }

    logger.log(`Successfully updated ${updatedCount} wallets`);
    if (notFoundCount > 0) {
      logger.warn(`Could not find currency for ${notFoundCount} wallets`);
    }

  } catch (error) {
    logger.error('Error populating wallet currency IDs:', error);
    throw error;
  } finally {
    await app.close();
    logger.log('Finished.');
  }
}

populateWalletCurrencyIds().catch(console.error);