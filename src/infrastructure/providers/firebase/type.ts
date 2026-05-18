export interface NotificationPayload {
  type: string;
  referenceId?: string;
  [key: string]: string | undefined;
}

export interface SendNotificationParams {
  userId: string;
  title: string;
  body: string;
  data?: NotificationPayload;
  imageUrl?: string;
}

export interface BroadcastNotificationParams {
  userIds: string[];
  title: string;
  body: string;
  data?: NotificationPayload;
  imageUrl?: string;
}

export interface FirebaseNotificationData {
  title: string;
  body: string;
  imageUrl?: string;
  data: NotificationPayload;
  createdAt: string;
  isRead: boolean;
  id: string;
}

export const FIREBASE_ERRORS = {
  INVALID_ARGUMENT: 'invalid-argument',
  NOT_FOUND: 'registration-token-not-registered',
  UNREGISTERED: 'registration-token-not-registered',
  INTERNAL: 'internal',
  QUOTA_EXCEEDED: 'quota-exceeded',
} as const;
