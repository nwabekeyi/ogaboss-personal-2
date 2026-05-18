import { Module, Global } from '@nestjs/common';
import { FirebaseCloudMessagingService } from './firebase-cloud-messaging.service';

@Global()
@Module({
  providers: [FirebaseCloudMessagingService],
  exports: [FirebaseCloudMessagingService],
})
export class FirebaseModule {}
