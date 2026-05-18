import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { firstValueFrom } from 'rxjs';
import { ProxyConfig, ProxyStatus } from './proxy.interface';

@Injectable()
export class ProxyManagerService {
  private readonly logger = new Logger(ProxyManagerService.name);
  private proxyPool: Map<string, ProxyStatus> = new Map();
  private currentProxy: ProxyConfig | null = null;

  // Updated proxy list with working SOCKS4 proxies
  private readonly proxyList: ProxyConfig[] = [
    { ip: '98.178.72.21', port: 10919 },
    // { ip: '190.96.97.202', port: 4153 },
    // { ip: '184.178.172.25', port: 15291 },
    // { ip: '174.75.211.222', port: 4145 },
  ];

  constructor(private readonly httpService: HttpService) {
    this.initializeProxyPool();
  }

  private async initializeProxyPool() {
    for (const proxy of this.proxyList) {
      await this.testAndAddProxy(proxy);
    }

    const workingProxies = Array.from(this.proxyPool.entries()).filter(
      ([_, status]) => status.isActive,
    );
  }

  private async testAndAddProxy(proxy: ProxyConfig) {
    const status = await this.checkProxyHealth(proxy);
    const key = this.getProxyKey(proxy);
    this.proxyPool.set(key, {
      ...proxy,
      ...status,
    });

    if (status.isActive) {
      this.logger.log(`Proxy ${key} is working (latency: ${status.latency}ms)`);
    }
  }

  private getProxyKey(proxy: ProxyConfig): string {
    return `${proxy.ip}:${proxy.port}`;
  }

  private async checkProxyHealth(
    proxy: ProxyConfig,
  ): Promise<Omit<ProxyStatus, 'ip' | 'port'>> {
    const startTime = Date.now();
    try {
      const agent = new SocksProxyAgent(`socks4://${proxy.ip}:${proxy.port}`);
      const response = await firstValueFrom(
        this.httpService.get('https://api.ipify.org?format=json', {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: 10000, // Increased timeout
          validateStatus: (status) => status === 200, // Only accept 200 responses
        }),
      );

      const latency = Date.now() - startTime;

      // Reject proxies with very high latency
      if (latency > 10000) {
        throw new Error('Proxy latency too high');
      }

      return {
        latency,
        lastChecked: new Date(),
        isActive: true,
      };
    } catch (error) {
      const errorMessage = this.getProxyErrorMessage(error);

      return {
        latency: -1,
        lastChecked: new Date(),
        isActive: false,
      };
    }
  }

  private getProxyErrorMessage(error: any): string {
    if (error.code === 'ETIMEDOUT') return 'Connection timed out';
    if (error.code === 'ECONNREFUSED') return 'Connection refused';
    if (error.code === 'ECONNRESET') return 'Connection reset';
    return error.message;
  }

  public async getWorkingProxy(): Promise<SocksProxyAgent> {
    const workingProxies = Array.from(this.proxyPool.entries())
      .filter(([_, status]) => status.isActive)
      .sort(([_, a], [__, b]) => a.latency - b.latency);

    if (workingProxies.length === 0) {
      this.logger.warn(
        'No working proxies available, retesting all proxies...',
      );
      await this.initializeProxyPool();

      const retestProxies = Array.from(this.proxyPool.entries()).filter(
        ([_, status]) => status.isActive,
      );

      if (retestProxies.length === 0) {
        throw new Error('No working proxies available after retest');
      }

      const [proxyKey, proxyStatus] = retestProxies[0];
      this.logger.log(
        `Using proxy: ${proxyKey} (latency: ${proxyStatus.latency}ms)`,
      );
      return new SocksProxyAgent(
        `socks4://${proxyStatus.ip}:${proxyStatus.port}`,
      );
    }

    const [proxyKey, proxyStatus] = workingProxies[0];
    this.logger.log(
      `Using proxy: ${proxyKey} (latency: ${proxyStatus.latency}ms)`,
    );
    return new SocksProxyAgent(
      `socks4://${proxyStatus.ip}:${proxyStatus.port}`,
    );
  }

  public async rotateProxy(): Promise<void> {
    await this.initializeProxyPool();
  }

  async executeWithProxy<T>(
    operation: (agent: SocksProxyAgent) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const agent = await this.getWorkingProxy();
        return await operation(agent);
      } catch (error) {
        this.logger.error(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt === maxRetries) {
          throw error;
        }

        // Rotate to different proxy
        await this.rotateProxy();
      }
    }
    throw new Error('All proxy attempts failed');
  }

  async reportFailedProxy() {
    this.logger.warn('Proxy request failed');
  }
}
