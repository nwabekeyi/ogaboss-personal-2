import {
  Status,
  TransactionStatus,
  TransactionType,
  TransactionContext,
} from '../databases/prisma/generated/prisma/client';

// ✅ Queue names as enum
export enum QueueName {
  EMAIL = 'email',
  PUSH = 'push',
  REPORT = 'report',
  CLEANUP = 'cleanup',
  QUIDAX_ACCOUNT = 'quidax-webhooks',
  SWAP = 'swap-transactions',
  ORDERS = 'sell-buy-orders',
  SEND = 'send-transactions',
  RECEIVE = 'receive-transactions',
  DASHBOARD_STATS = 'dashboard-stats',
  PAYSTACK = 'paystack',
  QUIDAX_WALLET = 'quidax-wallet-addresses',
  XPRESSPAY = 'xpresspay',
}

export interface JobData {
  [key: string]: any;
}

export enum EmailJobType {
  SIGNUP_INITIATE = 'signup-initiate',
  SIGNUP_COMPLETED = 'signup-completed',
  RESET_PIN = 'reset-pin',
  PIN_CHANGE_OTP = 'pin-change-otp',
  ENABLE_2FA = 'enable-2fa',
  LOGIN_2FA = 'login-2fa',
  ACCOUNT_LOCKED = 'account-locked',
  ADMIN_PASSWORD_RESET = 'admin-password-reset',
  TRANSACTION_NOTIFICATION = 'transaction-notification',
}
export type EmailJobPayload = {
  to: string;
  userId?: string;
  firstName?: string;
  otp?: string;
  timeLeft?: number;
  resetLink?: string;
  subject?: string;
  message?: string;
  transactionId?: string;
  transactionContext?: string;
  transactionStatus?: string;
  meta?: Record<string, any>;
};

export enum PushJobType {
  TRANSACTION_INITIATED = 'transaction-initiated',
  TRANSACTION_STATUS = 'transaction-status',
  PIN_CHANGED = 'pin-changed',
  PIN_CHANGE_OTP = 'pin-change-otp',
  ACCOUNT_LOCKED = 'account-locked',
  ENABLE_2FA = 'enable-2fa',
  LOGIN_2FA = 'login-2fa',
  SIGNUP_COMPLETED = 'signup-completed',
}

export type PushJobPayload = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export enum DashboardStatsJobType {
  UPDATE_FROM_TRANSACTION = 'update-from-transaction',
  REBUILD_FULL = 'rebuild-full',
  UPDATE_USERS = 'update-users',
}

export interface TransactionUpdatePayload {
  id: string;
  userId: string;
  currency: string;
  nairaAmountBase?: string | null;
  status: TransactionStatus;
  createdAt: string;
  transactionType: TransactionType;
  transactionContext: TransactionContext;
  senderWalletAddress?: string | null;
  receiverWalletAddress?: string | null;
  user?: {
    firstName?: string | null;
    lastName?: string | null;
  };
  network?: string;
}

export interface UserUpdatePayload {
  added: boolean;
  createdAt?: string;
  status?: Status;
}
