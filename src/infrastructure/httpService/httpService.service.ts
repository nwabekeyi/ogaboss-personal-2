import { Injectable, Logger } from '@nestjs/common';
import { HttpService as NestHttpService } from '@nestjs/axios';
import { AxiosRequestConfig, AxiosError } from 'axios';
import { HttpServiceException } from './errors';
import { CircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);

  constructor(
    private readonly http: NestHttpService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  async get<T>(
    url: string,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
    circuitBreakerName?: string,
  ): Promise<T> {
    return this.request<T>(
      'GET',
      url,
      undefined,
      headers,
      config,
      circuitBreakerName,
    );
  }

  async post<T>(
    url: string,
    data?: any,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
    circuitBreakerName?: string,
  ): Promise<T> {
    return this.request<T>(
      'POST',
      url,
      data,
      headers,
      config,
      circuitBreakerName,
    );
  }

  async put<T>(
    url: string,
    data?: any,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
    circuitBreakerName?: string,
  ): Promise<T> {
    return this.request<T>(
      'PUT',
      url,
      data,
      headers,
      config,
      circuitBreakerName,
    );
  }

  async delete<T>(
    url: string,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
    circuitBreakerName?: string,
  ): Promise<T> {
    return this.request<T>(
      'DELETE',
      url,
      undefined,
      headers,
      config,
      circuitBreakerName,
    );
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    data?: any,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
    circuitBreakerName?: string,
  ): Promise<T> {
    const action = () =>
      this.executeRequest<T>(method, url, data, headers, config);

    if (circuitBreakerName) {
      const breaker = this.circuitBreakerService.getBreaker(
        circuitBreakerName,
        action,
);
      return breaker.fire() as Promise<T>;
    }

    return action();
  }

  private async executeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    data?: any,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const timeout = 60000;

    try {
      const response = await this.http.axiosRef.request<T>({
        url,
        method,
        data,
        ...config,
        headers: { 'Content-Type': 'application/json', ...headers },
        timeout,
      });

      return response.data;
    } catch (error: unknown) {
      const status = this.getErrorStatus(error);

      this.logAndWarnError(method, url, error);

      throw new HttpServiceException(
        `Request failed: ${this.getErrorMessage(error)}`,
        status,
        error,
      );
    }
  }

  private getErrorStatus(error: unknown): number | undefined {
    if (error instanceof AxiosError) {
      return error.response?.status;
    }
    return undefined;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      return error.response?.data?.message || error.message || 'Request failed';
    } else if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }

  private logAndWarnError(method: string, url: string, error: unknown): void {
    const status = this.getErrorStatus(error);
    const message = this.getErrorMessage(error);
    const responseData = this.getErrorResponseData(error);

    const logMessage = status !== undefined
      ? `[HttpService] [${method}] ${url} failed with status ${status}: ${message}`
      : `[HttpService] [${method}] ${url} failed: ${message}`;

    this.logger.warn(logMessage, {
      method,
      url,
      statusCode: status,
      errorMessage: message,
      responseData: responseData ? JSON.stringify(responseData).substring(0, 500) : undefined,
      errorDetails: error instanceof Error ? {
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      } : undefined,
    });
  }

  private getErrorResponseData(error: unknown): any {
    if (error instanceof AxiosError) {
      return error.response?.data;
    }
    return undefined;
  }
}
