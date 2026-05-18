import dotenv from 'dotenv';
import { schema } from './schema';
import { Validate } from './validators';
import { ConfigTypes } from '../types';
import { ConfigFactory } from '@nestjs/config';

dotenv.config();

// validate environment variables
const envVarsSchema = Validate(schema);
const { error, value: envVariables } = envVarsSchema.validate(process.env);
if (error) throw new Error(`Config validation error: ${error.message}`);
const configFunction: ConfigFactory<ConfigTypes> = (): ConfigTypes => ({
  env: envVariables.NODE_ENV,
  port: Number(envVariables.PORT),
  adminFrontendUrlDev: envVariables.ADMIN_FRONTEND_URL_DEV,
  adminFrontendUrlProd: envVariables.ADMIN_FRONTEND_URL_PROD,
  frontendUrlDev: envVariables.FRONTEND_URL_DEV,
  frontendUrlProd: envVariables.FRONTEND_URL_PROD,
  serverUrl: envVariables.SERVER_URL,
  sentryDSN: envVariables.SENRTY_DSN,
  encryptionKey: envVariables.ENCRYPTION_KEY,
  superAdminKey: envVariables.SUPER_ADMIN_KEY,
  store: {
    database: {
      postgres: {
        url: envVariables.DATABASE_URL,
        secureHost: envVariables.DATABASE_URL,
        testUrl: envVariables.DATABASE_URL,
      },
    },
  },
  client: {
    mediaClient: {
      imageKit: {
        publicKey: envVariables.IMAGEKIT_PUBLIC_KEY,
        privateKey: envVariables.IMAGEKIT_PRIVATE_KEY,
        urlEndpoint: envVariables.IMAGEKIT_URL_ENDPOINT,
      },
    },
    mailClient: {
      zeptoMail: {
        url: envVariables.ZEPTOMAIL_URL || 'https://api.zeptomail.com/',
        token: envVariables.ZEPTOMAIL_TOKEN,
        sender: envVariables.ZEPTOMAIL_SENDER || ' noreply@ogaboss.io',
      },
    },
  },
  credentials: {
    jwt: {
      accessSecret: envVariables.JWT_ACCESS_SECRET,
      accessExpirationInterval: envVariables.JWT_ACCESS_EXPIRATION,
      refreshSecret: envVariables.JWT_REFRESH_SECRET,
      refreshExpirationInterval: envVariables.JWT_REFRESH_EXPIRATION,
      bankVerification: envVariables.JWT_BANK_VERIFY_SECRET
    },
    dojah: {
      apiTest: envVariables.DOJAH_API_TEST,
      secretKeyTest: envVariables.DOJAH_SECRET_KEY_TEST,
      appIdTest: envVariables.DOJAH_APP_ID_TEST,
      apiLive: envVariables.DOJAH_API_LIVE,
      secretKeyLive: envVariables.DOJAH_SECRET_KEY_LIVE,
      appIdLive: envVariables.DOJAH_APP_ID_LIVE,
    },
    quidax: {
      apiUrl: envVariables.QUIDAX_API_URL,
      apiKey: envVariables.QUIDAX_API_KEY,
      secretKey: envVariables.QUIDAX_API_SECRET_KEY,
      webhookSecret: envVariables.QUIDAX_WEBHOOK_SECRET
    },
    cloudflare: {
      siteKey: envVariables.CLOUDFLARE_SITE_KEY,
      secret: envVariables.CLOUDFLARE_SECRET,
    }
  },
  defaults: {
    supportEmail: envVariables.SUPPORT_EMAIL,
    rateLimiter: {
      duration: Number(envVariables.RATE_LIMIT_DURATION_SECONDS),
      points: Number(envVariables.RATE_LIMIT_PERMISSION_POINTS),
    },
    saltWorker: Number(envVariables.SALT_WORKER),
    proxy: {
      enabled: envVariables.PROXY_ENABLED === 'true',
    },
  },
});

export const config = configFunction() as ConfigTypes;

export function assertNoUndefined(obj: any, path = '', missing: string[] = []): string[] {
  for (const key in obj) {
    const value = obj[key];
    const currentPath = path ? `${path}.${key}` : key;

    if (value === undefined || (typeof value === 'number' && isNaN(value))) {
      missing.push(currentPath);
    }

    if (typeof value === 'object' && value !== null) {
      assertNoUndefined(value, currentPath, missing);
    }
  }

  return missing;
}

// **Collect all missing config values**
const missingConfigs = assertNoUndefined(config);

if (missingConfigs.length > 0) {
  console.error('❌ Missing or invalid configuration values:');
  missingConfigs.forEach((path) => console.error(`  - ${path}`));
  process.exit(1); // block the app
}