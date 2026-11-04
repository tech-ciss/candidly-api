import { isIP } from 'node:net';
export function normalizePeer(ip: string): string {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}
export function proxyTrust(trustedIp: string): (ip: string) => boolean {
  return (ip: string): boolean =>
    trustedIp !== '' && normalizePeer(ip) === normalizePeer(trustedIp);
}
