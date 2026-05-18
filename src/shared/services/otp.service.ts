import { Injectable, NotFoundException } from '@nestjs/common';
import { TempStoreService } from '../../infrastructure/databases/redis';

export type OtpPurpose =
  | 'signup'
  | 'pin_reset'
  | 'pin_change'
  | 'enable_2fa'
  | 'login_2fa'
  | 'generic';

@Injectable()
export class OtpService {
  constructor(private readonly tempStoreService: TempStoreService) {}

  private key(email: string, purpose: OtpPurpose) {
    return `otp:${purpose}:${email.toLowerCase().trim()}`;
  }

  async issueOtp(
    email?: string,
    expirationTime = 600,
    manualOtp?: number,
    purpose: OtpPurpose = 'generic',
  ): Promise<{ emailOtp: string; timeLeft: number }> {
    if (!email) {
      throw new Error('Email is required to issue OTP');
    }

    const otpKey = this.key(email, purpose);
    const existingOtp = await this.tempStoreService.get(otpKey);

    if (existingOtp) {
      const ttlSeconds = await this.tempStoreService.ttl(otpKey);
      if (ttlSeconds > 0) {
        await this.tempStoreService.del(otpKey);
      }
    }

    const otp = manualOtp || this.generateOtp();

    await this.tempStoreService.set(otpKey, `${otp}`, expirationTime);

    return {
      emailOtp: otp.toString(),
      timeLeft: this.toMinutes(expirationTime),
    };
  }

  async verifyOtp({
    otp,
    email,
    keepAlive = false,
    purpose = 'generic',
  }: {
    otp: string;
    email?: string;
    keepAlive?: boolean;
    purpose?: OtpPurpose;
  }): Promise<boolean> {
    if (!email) return false;

    const otpKey = this.key(email, purpose);
    const storedOtp = await this.tempStoreService.get(otpKey);

    if (storedOtp === null) {
      throw new NotFoundException('OTP not found');
    }

    if (storedOtp.toString() !== otp) return false;

    if (!keepAlive) {
      await this.tempStoreService.del(otpKey);
    }

    return true;
  }

  private toMinutes(seconds: number): number {
    return Math.floor(seconds / 60);
  }

  private generateOtp(): number {
    return Math.floor(100000 + Math.random() * 900000);
  }
}
