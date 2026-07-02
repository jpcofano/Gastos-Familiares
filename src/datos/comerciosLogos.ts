import { COMERCIOS_DOMINIOS } from './comerciosDominios';

const CID = import.meta.env.VITE_BRANDFETCH_CLIENT_ID ?? '1idDEHYBi7zAzQv9-MQ';
const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const logoCDN = (d: string) => `https://cdn.brandfetch.io/domain/${d}/w/120/h/120?c=${CID}`;

function pareceComercio(nombre: string): boolean {
  const n = norm(nombre);
  if (!n) return false;
  if (COMERCIOS_DOMINIOS.some(o => o.match.some(m => n.includes(m)))) return true;
  return /\b(s\.?a\.?|s\.?r\.?l|srl|s\.?a\.?s|inc|ltda|coop|ute)\b/.test(n);
}

const mem = new Map<string, string | null>();
const lsGet = (k: string) => { try { return localStorage.getItem('gf-logo:' + k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem('gf-logo:' + k, v); } catch {} };

export async function logoDeComercio(nombre: string): Promise<string | null> {
  const key = norm(nombre);
  if (!key) return null;
  if (mem.has(key)) return mem.get(key) ?? null;
  const ls = lsGet(key);
  if (ls !== null) { const v = ls || null; mem.set(key, v); return v; }

  // (a) override curado → Logo CDN por dominio
  const ov = COMERCIOS_DOMINIOS.find(o => o.match.some(m => key.includes(m)));
  if (ov) { const u = logoCDN(ov.dominio); mem.set(key, u); lsSet(key, u); return u; }

  // (b) Brand Search — solo si parece comercio
  if (!pareceComercio(nombre)) { mem.set(key, null); lsSet(key, ''); return null; }
  try {
    const r = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(nombre)}?c=${CID}`);
    const arr = (await r.json()) as Array<{ icon?: string; domain?: string; verified?: boolean; claimed?: boolean; qualityScore?: number }>;
    const best = (arr ?? [])
      .filter(x => x.icon || x.domain)
      .sort((a, b) =>
        (Number(b.verified) - Number(a.verified)) ||
        (Number(b.claimed) - Number(a.claimed)) ||
        ((b.qualityScore ?? 0) - (a.qualityScore ?? 0))
      )[0];
    const url = best?.icon || (best?.domain ? logoCDN(best.domain) : null);
    mem.set(key, url ?? null);
    lsSet(key, url ?? '');
    return url ?? null;
  } catch {
    mem.set(key, null);
    return null;
  }
}
