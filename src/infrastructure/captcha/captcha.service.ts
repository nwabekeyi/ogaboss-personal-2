import { Injectable, ForbiddenException } from '@nestjs/common';
import { HttpService } from '../httpService/httpService.service';
import { CLOUDFLARE_TURNSTILE_VERIFY_URL } from './constants';
import { TurnstileVerifyResponse } from './types';

@Injectable()
export class CaptchaService {
  constructor(private readonly httpService: HttpService) {}

  async verify(token: string, ip?: string): Promise<void> {
    if (!token) {
      throw new ForbiddenException('Captcha token error');
    }

    const response = await this.httpService.post<TurnstileVerifyResponse>(
      CLOUDFLARE_TURNSTILE_VERIFY_URL,
      new URLSearchParams({
        secret: process.env.CLOUDFLARE_SECRET!,
        response: token,
        ...(ip && { remoteip: ip }),
      }),
      {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    );
    const ERROR_MESSAGES: Record<string, string> = {
      'missing-input-secret': 'Captcha configuration error: missing secret key',
      'invalid-input-secret': 'Captcha configuration error: invalid secret key',
      'missing-input-response':
        'Captcha token missing. Please complete the verification.',
      'invalid-input-response': 'Captcha token invalid. Please try again.',
      'invalid-keys': 'Captcha configuration error: invalid API keys',
      'timeout-or-duplicate': 'Captcha verification expired. Please try again.',
      'challenge-error': 'Captcha challenge failed. Please try again.',
    };

    if (!response.success) {
      const errorCodes = response['error-codes'] || [];
      const message =
        errorCodes.map((code) => ERROR_MESSAGES[code] || code).join(', ') ||
        'Captcha verification failed';
      throw new ForbiddenException(message);
    }
  }
}
