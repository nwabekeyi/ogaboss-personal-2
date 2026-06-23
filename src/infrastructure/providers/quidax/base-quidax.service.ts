// src/infrastructure/providers/quidax/base-quidax.service.ts
import {
  Injectable,
  BadGatewayException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '../../../infrastructure/httpService';
import * as crypto from 'crypto';
import { ErrorMessages, Providers } from '../../../shared';

@Injectable()
export class BaseQuidaxService {
  constructor(private readonly httpService: HttpService) {}
  protected readonly logger = new Logger(BaseQuidaxService.name);

  protected async request<T = any>(config: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: any;
    params?: Record<string, any>;
    headers?: Record<string, string>;
    skipCircuitBreaker?: boolean;
  }): Promise<T> {
    try {
      const response = await this.httpService.request<T>(
        config.method,
        `${process.env.QUIDAX_API_URL}${config.url}`,
        config.data,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
          ...config.headers,
        },
        { params: config.params },
        config.skipCircuitBreaker ? undefined : Providers.QUIDAX,
      );

      // console.log(`[Quidax] Request successful: ${config.method} ${config.url}, ${JSON.stringify(response)}`);
      return response;
    } catch (error: any) {
      // Log the full error response for debugging
      const errorData = error.response?.data;
      this.logger.error('[Quidax] Request failed', {
        url: config.url,
        method: config.method,
        data: config.data,
        params: config.params,
        status: error.response?.status,
        reason: errorData?.message || errorData?.data?.message || error.message,
        errorCode: errorData?.data?.code || errorData?.code,
        fullResponse: errorData,
      });

      // If Quidax returned a response with data, return it (even if error status)
      // This allows callers to handle the response (e.g., user already created)
      if (error.response?.data) {
        const responseData = error.response.data;
        // Check if it's a valid Quidax response (has status field)
        if (responseData.status !== undefined) {
          return responseData;
        }
        // For other error responses, log and continue
        this.logger.warn(
          '[Quidax] Non-standard error response returned',
          responseData,
        );
      }

      // For 500 errors or missing responses, throw a more descriptive error
      const status = error.response?.status;
      if (status === 500 || status === 502 || status === 503) {
        throw new BadGatewayException(`Quidax service unavailable (${status})`);
      }

      throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE);
    }
  }

  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
  ): boolean {
    if (!signatureHeader) throw new UnauthorizedException('Missing signature');

    this.logger.debug(`Verifying signature with header: ${signatureHeader}`);
    this.logger.debug(`Raw body: ${rawBody.toString().substring(0, 200)}...`);

    const [timestampPart, signaturePart] = signatureHeader.split(',');
    const timestamp = timestampPart.split('=')[1];
    const receivedSignature = signaturePart.split('=')[1];

    this.logger.debug(
      `Timestamp: ${timestamp}, Received signature: ${receivedSignature}`,
    );

    const payload = `${timestamp}.${rawBody.toString()}`;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.QUIDAX_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    this.logger.debug(`Expected signature: ${expectedSignature}`);

    if (receivedSignature !== expectedSignature) {
      this.logger.error(
        `Signature mismatch! Received: ${receivedSignature}, Expected: ${expectedSignature}`,
      );
      throw new UnauthorizedException('Invalid Quidax signature');
    }

    const fiveMinutesInSeconds = 300;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > fiveMinutesInSeconds) {
      throw new UnauthorizedException('Webhook timestamp expired');
    }

    this.logger.debug('Signature verification passed');
    return true;
  }
}
