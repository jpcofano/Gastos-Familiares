export interface NormRule {
  tipo: 'prefix' | 'suffix' | 'replace' | 'regex';
  patron: string;
  reemplazo: string;
}

export function normalizar(s: string, rules: NormRule[]): string {
  if (s === null || s === undefined || s === '') return s as string;
  let out = String(s);          // ← FIX: convertir a string sí o sí
  for (const r of rules) {
    if (!out) break;
    switch (r.tipo) {
      case 'prefix':
        if (out.startsWith(r.patron)) out = (r.reemplazo + out.slice(r.patron.length)).trim();
        break;
      case 'suffix':
        if (out.endsWith(r.patron)) out = (out.slice(0, -r.patron.length) + r.reemplazo).trim();
        break;
      case 'replace':
        out = out.split(r.patron).join(r.reemplazo).trim();
        break;
      case 'regex':
        try { out = out.replace(new RegExp(r.patron, 'gi'), r.reemplazo).trim(); }
        catch { /* regex invalido, ignorar */ }
        break;
    }
  }
  return out;
}
