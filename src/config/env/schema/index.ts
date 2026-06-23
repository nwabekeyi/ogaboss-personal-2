import { Joi } from 'celebrate';

export const schema = {
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(4500),
  APP_NAME: Joi.string().required(),

  // Database
  DATABASE_URL: Joi.string().required(),
  SHADOW_DATABASE_URL: Joi.string().required(),

  // URLs
  FRONTEND_URL_DEV: Joi.string().required(),
  FRONTEND_URL_PROD: Joi.string().required(),
  ADMIN_FRONTEND_URL_DEV: Joi.string().required(),
  ADMIN_FRONTEND_URL_PROD: Joi.string().required(),
  SERVER_URL: Joi.string().required(),

  // JWT
  SALT_WORKER: Joi.number().required(),
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRATION: Joi.string().required(),
  JWT_EMAIL_VERIFICATION_SECRET: Joi.string().required(),
  JWT_EMAIL_VERIFICATION_EXPIRATION: Joi.string().required(),
  JWT_PASSWORD_RESET_SECRET: Joi.string().required(),
  JWT_PASSWORD_RESET_EXPIRATION: Joi.string().required(),
  JWT_PASSWORD_CHANGE_SECRET: Joi.string().required(),
  JWT_PASSWORD_CHANGE_EXPIRATION: Joi.string().required(),
  JWT_BANK_VERIFY_SECRET: Joi.string().required(),

  // Quidax
  QUIDAX_API_URL: Joi.string().required(),
  QUIDAX_API_KEY: Joi.string().required(),
  QUIDAX_API_SECRET_KEY: Joi.string().required(),
  QUIDAX_WEBHOOK_SECRET: Joi.string().required(),

  // ImageKit
  IMAGEKIT_PUBLIC_KEY: Joi.string().required(),
  IMAGEKIT_PRIVATE_KEY: Joi.string().required(),
  IMAGEKIT_URL_ENDPOINT: Joi.string().required(),

  // Dojah
  DOJAH_API_TEST: Joi.string().required(),
  DOJAH_APP_ID_TEST: Joi.string().required(),
  DOJAH_PUBLIC_KEY_TEST: Joi.string().required(),
  DOJAH_SECRET_KEY_TEST: Joi.string().required(),
  DOJAH_API_LIVE: Joi.string().required(),
  DOJAH_APP_ID_LIVE: Joi.string().required(),
  DOJAH_PUBLIC_KEY_LIVE: Joi.string().required(),
  DOJAH_SECRET_KEY_LIVE: Joi.string().required(),

  // Account Tiers
  TIER_1_DAILY_TRANSFER_LIMIT: Joi.number().required(),
  TIER_2_DAILY_TRANSFER_LIMIT: Joi.number().required(),
  TIER_3_DAILY_TRANSFER_LIMIT: Joi.string().required(),
  TIER_1_CUMULATIVE_BALANCE_LIMIT: Joi.number().required(),
  TIER_2_CUMULATIVE_BALANCE_LIMIT: Joi.number().required(),
  TIER_3_CUMULATIVE_BALANCE_LIMIT: Joi.string().required(),

  // Email (ZeptoMail)
  ZEPTOMAIL_URL: Joi.string().required(),
  ZEPTOMAIL_TOKEN: Joi.string().required(),
  ZEPTOMAIL_SENDER: Joi.string().required(),
  SUPPORT_EMAIL: Joi.string().allow('').required(),

  // Paystack
  PAYSTACK_SECRET_KEY_TEST: Joi.string().required(),
  PAYSTACK_PUBLIC_KEY_TEST: Joi.string().required(),

  // Redis
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  // Sentry
  SENRTY_DSN: Joi.string().required(),

  // Rate Limiter
  RATE_LIMIT_DURATION_SECONDS: Joi.number().required(),
  RATE_LIMIT_PERMISSION_POINTS: Joi.number().required(),

  // Encryption
  ENCRYPTION_KEY: Joi.string().required(),

  // Cloudflare
  CLOUDFLARE_SITE_KEY: Joi.string().required(),
  CLOUDFLARE_SECRET: Joi.string().required(),

  // Super Admin
  SUPER_ADMIN_KEY: Joi.string().required(),

  // Firebase
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),

  // Vault
  VAULT_TRANSACTION_FEE: Joi.number().required(),
  VAULT_QUOTE_TTL_SECONDS: Joi.number().default(300),

  // Internal
  SUPERADMIN_EMAIL: Joi.string().required(),

  // Scheduler
  ENABLE_SCHEDULERS: Joi.string().required(),
};