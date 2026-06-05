import { createHash } from 'crypto';

export function sha256Hex(...parts: (string | number | null | undefined)[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(String(p ?? ''));
  return h.digest('hex');
}
