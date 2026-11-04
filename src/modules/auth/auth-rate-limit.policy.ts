export const RATE_LIMIT_WINDOW_SECONDS = 900;
export function rateLimitFor(handler: string): number {
  return ['verify', 'refresh', 'logout'].includes(handler) ? 30 : 5;
}
