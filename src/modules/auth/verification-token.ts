import { createHash, randomBytes } from 'node:crypto';
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function createVerificationToken(
  ttlSeconds: number,
  now = new Date(),
): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('base64url');
  return {
    raw,
    hash: hashToken(raw),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}
