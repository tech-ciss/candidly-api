export function companyName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}
export function normalizedCompanyName(value: string): string {
  return companyName(value).toLowerCase().normalize('NFC');
}
