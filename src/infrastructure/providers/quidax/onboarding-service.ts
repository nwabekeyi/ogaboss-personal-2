// src/infrastructure/providers/quidax/quidax-onboarding.service.ts
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { QuidaxAccountService } from './account.service';
import { QueueService } from '../../bullMQ/bullmq.service';
import { QueueName } from '../../bullMQ';

export interface OnboardingPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class QuidaxOnboardingService {
  private readonly logger = new Logger(QuidaxOnboardingService.name);

  constructor(
    private readonly quidaxAccountService: QuidaxAccountService,
  ) {}

  async createSubaccountAndQueue(payload: OnboardingPayload): Promise<void> {
    const { email, firstName, lastName } = payload;

    const accountRes = await this.quidaxAccountService.createSubAccount({
      email,
      first_name: firstName,
      last_name: lastName,
    });

    if (!accountRes.data?.id) {
      this.logger.error('Quidax returned invalid subaccount response', accountRes);
      throw new BadGatewayException(
        'Failed to create user account. Please try again later.'
      );
    }

  }
}