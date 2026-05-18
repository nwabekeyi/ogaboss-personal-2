import crypto from 'crypto';
import { config } from '../../config';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY = Buffer.from(config.encryptionKey!, 'hex');

export function encrypt (text: string) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    content: encrypted,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

export function decrypt(data: {
  content: string;
  iv: string;
  tag: string;
}) {
  const decipher = crypto.createDecipheriv(
    ALGO,
    KEY,
    Buffer.from(data.iv, 'hex'),
  );

  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));

  let decrypted = decipher.update(data.content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
