export interface ProxyConfig {
  ip: string;
  port: number;
}

export interface ProxyStatus {
  ip: string;
  port: number;
  latency: number;
  lastChecked: Date;
  isActive: boolean;
}
