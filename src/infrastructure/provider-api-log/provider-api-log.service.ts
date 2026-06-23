import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { PrismaService } from '../databases/prisma';

export interface ExternalProviderApiLogInput {
  provider?: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, any>;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: any;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

type TrackedAxiosConfig = any & {
  __externalProviderLog?: {
    startedAt: number;
    provider: string;
  };
};

@Injectable()
export class ExternalProviderApiLogService implements OnModuleInit {
  private readonly logger = new Logger(ExternalProviderApiLogService.name);
  private interceptorsRegistered = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (this.interceptorsRegistered) return;
    this.interceptorsRegistered = true;

    axios.interceptors.request.use((config: TrackedAxiosConfig) => {
      const url = this.buildUrl(config.url, config.baseURL);
      config.__externalProviderLog = {
        startedAt: Date.now(),
        provider: this.inferProvider(url),
      };
      return config;
    });

    axios.interceptors.response.use(
      async (response: AxiosResponse) => {
        if (this.isProviderResponseFailure(response.data)) {
          await this.logAxiosResponseFailure(response).catch(() => undefined);
        }
        return response;
      },
      async (error: AxiosError) => {
        await this.logAxiosError(error).catch(() => undefined);
        return Promise.reject(error);
      },
    );
  }

  async log(input: ExternalProviderApiLogInput): Promise<void> {
    const url = input.url;
    const provider = input.provider || this.inferProvider(url);
    const durationMs = input.durationMs ?? null;
    const responseStatus = input.responseStatus ?? null;
    const errorMessage = input.errorMessage ?? null;
    const requestHeaders = JSON.stringify(
      this.sanitize(input.requestHeaders ?? null),
    );
    const requestBody = JSON.stringify(this.sanitize(input.requestBody ?? null));
    const responseBody = JSON.stringify(this.sanitize(input.responseBody ?? null));
    const metadata = JSON.stringify(input.metadata ?? null);

    try {
      await this.prisma.$executeRaw`
        INSERT INTO "external_provider_api_logs" (
          "id",
          "provider",
          "method",
          "url",
          "requestHeaders",
          "requestBody",
          "responseStatus",
          "responseBody",
          "success",
          "errorMessage",
          "durationMs",
          "metadata",
          "createdAt"
        ) VALUES (
          ${randomUUID()},
          ${provider},
          ${input.method.toUpperCase()},
          ${url},
          ${requestHeaders}::jsonb,
          ${requestBody}::jsonb,
          ${responseStatus},
          ${responseBody}::jsonb,
          ${input.success},
          ${errorMessage},
          ${durationMs},
          ${metadata}::jsonb,
          NOW()
        )
      `;
    } catch (error: any) {
      this.logger.warn(
        `Failed to persist external provider API log for ${input.method} ${url}: ${error?.message}`,
      );
    }
  }

  inferProvider(url: string): string {
    const lower = (url || '').toLowerCase();
    if (lower.includes('quidax')) return 'QUIDAX';
    if (lower.includes('paystack')) return 'PAYSTACK';
    if (lower.includes('dojah')) return 'DOJAH';
    if (lower.includes('xpress')) return 'XPRESSPAY';
    if (lower.includes('zeptomail')) return 'ZEPTOMAIL';
    if (lower.includes('imagekit')) return 'IMAGEKIT';
    return 'UNKNOWN';
  }

  isProviderResponseFailure(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    const status = data.status;
    if (status === false) return true;
    if (typeof status === 'string') {
      return ['error', 'failed', 'failure'].includes(status.toLowerCase());
    }
    return false;
  }

  getProviderFailureMessage(data: any): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    return data.message || data.error || data.reason || undefined;
  }

  private async logAxiosResponseFailure(response: AxiosResponse): Promise<void> {
    const config = response.config as TrackedAxiosConfig;
    const url = this.buildUrl(config.url, config.baseURL);
    const startedAt = config.__externalProviderLog?.startedAt ?? Date.now();

    await this.log({
      provider: config.__externalProviderLog?.provider,
      method: (config.method || 'GET').toUpperCase(),
      url,
      requestHeaders: config.headers as Record<string, any>,
      requestBody: config.data,
      responseStatus: response.status,
      responseBody: response.data,
      success: false,
      errorMessage: this.getProviderFailureMessage(response.data),
      durationMs: Date.now() - startedAt,
    });
  }

  private async logAxiosError(error: AxiosError): Promise<void> {
    const config = (error.config || {}) as TrackedAxiosConfig;
    const url = this.buildUrl(config.url, config.baseURL);
    const startedAt = config.__externalProviderLog?.startedAt ?? Date.now();

    await this.log({
      provider: config.__externalProviderLog?.provider,
      method: (config.method || 'GET').toUpperCase(),
      url,
      requestHeaders: config.headers as Record<string, any>,
      requestBody: config.data,
      responseStatus: error.response?.status,
      responseBody: error.response?.data,
      success: false,
      errorMessage: this.getAxiosErrorMessage(error),
      durationMs: Date.now() - startedAt,
    });
  }

  private buildUrl(url?: string, baseURL?: string): string {
    if (!url) return baseURL || '';
    if (/^https?:\/\//i.test(url)) return url;
    if (!baseURL) return url;
    return `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  }

  private getAxiosErrorMessage(error: AxiosError): string {
    const data = error.response?.data as any;
    return data?.message || error.message || 'Request failed';
  }

  private sanitize(value: any): any {
    if (value == null) return value;

    if (typeof value === 'string') {
      try {
        return this.sanitize(JSON.parse(value));
      } catch {
        return value.length > 5000 ? `${value.slice(0, 5000)}...` : value;
      }
    }

    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));

    if (typeof value === 'object') {
      const redactedKeys = [
        'authorization',
        'authorization_code',
        'password',
        'pin',
        'secret',
        'secret_key',
        'api_key',
        'token',
        'access_token',
        'refresh_token',
        'private_key',
      ];
      return Object.entries(value).reduce<Record<string, any>>((acc, [key, val]) => {
        const lowerKey = key.toLowerCase();
        acc[key] = redactedKeys.some((redacted) => lowerKey.includes(redacted))
          ? '[REDACTED]'
          : this.sanitize(val);
        return acc;
      }, {});
    }

    return value;
  }
}