import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class XpresspayService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl() {
    return this.config.get<string>('XPRESSPAY_BASE_URL', '');
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.config.get<string>('XPRESSPAY_API_KEY', '')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async getBillCategories() {
    const { data } = await firstValueFrom(this.http.get(`${this.baseUrl}/bills/categories`, { headers: this.headers }));
    return data;
  }

  async getBillers(category: string) {
    const { data } = await firstValueFrom(this.http.get(`${this.baseUrl}/bills/billers`, { headers: this.headers, params: { category } }));
    return data;
  }

  async validateBill(payload: Record<string, any>) {
    const { data } = await firstValueFrom(this.http.post(`${this.baseUrl}/bills/validate`, payload, { headers: this.headers }));
    return data;
  }

  async payBill(payload: Record<string, any>) {
    const { data } = await firstValueFrom(this.http.post(`${this.baseUrl}/bills/pay`, payload, { headers: this.headers }));
    return data;
  }
}
