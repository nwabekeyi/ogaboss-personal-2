import { Controller, Get } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ProxyManagerService } from './proxy-manager.service';
import { firstValueFrom } from 'rxjs';

@Controller('/v1/proxy')
export class ProxyController {
  constructor(
    private readonly httpService: HttpService,
    private readonly proxyManager: ProxyManagerService,
  ) {}

  @Get('test')
  async testProxy() {
    try {
      const agent = await this.proxyManager.getWorkingProxy();
      const response = await firstValueFrom(
        this.httpService.get('https://api.ipify.org?format=json', {
          httpAgent: agent,
          httpsAgent: agent,
        }),
      );
      return {
        success: true,
        proxyIP: response.data.ip,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
