import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { Logger } from '@nestjs/common';
import { FirebaseCloudMessagingService } from '../../infrastructure/providers/firebase/firebase-cloud-messaging.service';
import { DevicePlatform } from '../../infrastructure/databases/prisma/generated/prisma/client';

const USER_ID = 'YOUR USER ID HERE'; // Replace with a valid user ID from your database
const DEVICE_TOKEN ='USER TOKEN HERE'; // Replace with a valid FCM device token from your test device

async function main() {
  const logger = new Logger('TestFCMNotification');

  logger.log(`Testing FCM for user: ${USER_ID}`);
  logger.log(`Device token: ${DEVICE_TOKEN}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const fcmService = app.get(FirebaseCloudMessagingService);

  logger.log('Adding device token for user...');
  await fcmService.addDeviceToken(
    USER_ID,
    DEVICE_TOKEN,
    DevicePlatform.ANDROID,
    'Test Device',
    'test-device-001',
  );
  logger.log('Device token added successfully');

  logger.log('Sending test notification...');
  const result = await fcmService.sendNotification({
    userId: USER_ID,
    title: 'Test Notification',
    body: 'This is a test notification from the FCM script',
    data: {
      type: 'test',
      customKey: 'customValue',
    },
  });

  logger.log('=== FCM SEND RESULT ===');
  logger.log(JSON.stringify(result, null, 2));

  if (result) {
    logger.log(`✅ Notification sent! ID: ${result.id}`);
  } else {
    logger.error('❌ Notification failed');
  }

  await app.close();
}

main()
  .then(() => {
    console.log('\nScript completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nScript failed:', err);
    process.exit(1);
  });
