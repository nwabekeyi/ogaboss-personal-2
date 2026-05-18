export type ConfigTypes = {
  env: string;
  port: number;
  adminFrontendUrlDev: string;
  adminFrontendUrlProd: string;
  frontendUrlDev: string;
  frontendUrlProd: string;
  serverUrl: string;
  sentryDSN: string;
  encryptionKey: string;
  superAdminKey: string;
  store: {
    database: {
      postgres: IPostgres;
    };
  };
  client: {
    mailClient: {
      zeptoMail: IZeptoMail;
    };
    mediaClient: {
      imageKit: IImageKit;
    };
  };
  credentials: {
    jwt: IJWT;
    dojah: IDojah;
    quidax: IQuidax;
    cloudflare: ICloudflare
  };
  defaults: {
    supportEmail: string;
    rateLimiter: IRateLimiter;
    saltWorker: number;
    proxy: {
      enabled: boolean;
    };
  };
};

interface INodeMailer {
  host: string;
  port: number;
  isSecure: boolean;
  authEmail: string;
  authPassword: string;
}

interface ICloudflare {
  siteKey: string;
  secret: string;
}

interface IJWT {
  accessSecret: string;
  accessExpirationInterval: string;
  refreshSecret: string;
  refreshExpirationInterval: string;
  bankVerification: string
}

interface IImageKit {
  publicKey: string;
  privateKey: string;
  urlEndpoint: string;
}

interface IDojah {
  apiTest: string;
  secretKeyTest: string;
  appIdTest: string;
  apiLive: string;
  secretKeyLive: string;
  appIdLive: string;
}

interface IPostgres {
  url: string;
  secureHost: string;
  testUrl: string;
}


interface IQuidax {
  apiUrl: string;
  apiKey: string;
  secretKey: string;
  webhookSecret: String;
}
