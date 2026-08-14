// F9.139 — verificación post-cambio. SOLO LEE.
//
// Los dos criterios de aceptación end-to-end del §6 (confirmar un resumen, dar de alta un
// comprobante) necesitan la UI. Lo que SÍ se puede verificar sin ella es que las funciones nuevas,
// alimentadas con los datos REALES de prod, devuelven lo que tienen que devolver. Eso es lo que
// hace esto: corre `bancoCanonicoDeResumen` (replicada) y `medioPorDefecto` (importada) contra los
// 26 resúmenes y la config reales.
//
// Uso: npx tsx scripts/verificarF9139.ts --target=production

import { getDb } from './seed/utils/firestore';
import { medioPorDefecto, ALIAS_NOMBRE_MEDIO } from '../src/datos/medios';
import type { MedioPago } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

// Réplica EXACTA de la precedencia de src/datos/resumenesTarjeta.ts (bancoCanonicoDeResumen).
// Se replica y no se importa porque ese módulo arrastra el SDK de cliente (firebase/firestore),
// que no levanta bajo node. Si divergen, este chequeo deja de valer — están juntos a propósito.
function bancoCanonico(resumen: any, bancos: MedioPago[], tarjetas: any[]): { banco: string | null; via: string } {
  const porTarjeta = tarjetas.find(t => t.codigo === resumen.tarjetaCodigo)?.banco;
  if (porTarjeta) return { banco: porTarjeta, via: '1 config.tarjetas' };

  const crudo = (resumen.banco ?? '').trim();
  if (crudo) {
    const exacto = bancos.find(b => b.nombre === crudo);
    if (exacto) return { banco: exacto.nombre, via: '2 match exacto' };
    const alias = ALIAS_NOMBRE_MEDIO[crudo.toLowerCase()];
    if (alias) return { banco: alias, via: '3 alias' };
  }
  return { banco: medioPorDefecto(bancos)?.nombre ?? null, via: '4 default (+warn)' };
}

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const cfg = (await db.collection('config').doc('familia').get()).data() as any;
  const bancos: MedioPago[] = cfg?.bancos ?? [];
  const tarjetas: any[] = cfg?.tarjetas ?? [];

  console.log('=== config/familia.bancos (post-cambio) ===');
  for (const b of bancos) console.log(`  ${String(b.nombre).padEnd(15)} ${b.porDefecto ? '← porDefecto' : ''}`);
  const efectivo = bancos.find(b => b.nombre === 'Efectivo');
  const defaults = bancos.filter(b => b.porDefecto);
  console.log(`\n  Efectivo presente: ${efectivo ? 'SÍ ← MAL' : 'no ✓'}`);
  console.log(`  exactamente un porDefecto: ${defaults.length === 1 ? `sí ✓ (${defaults[0].nombre})` : `NO ← MAL (${defaults.length})`}`);
  console.log(`  medioPorDefecto() devuelve: ${medioPorDefecto(bancos)?.nombre}`);

  // §4 — el preload del comprobante
  console.log('\n=== §4 — banco del preload de un comprobante (rama 2/3) ===');
  console.log(`  antes: "Efectivo" (hardcodeado) · ahora: "${medioPorDefecto(bancos)?.nombre}"`);

  // §3 — los 26 resúmenes reales
  console.log('\n=== §3 — banco resuelto para los resúmenes reales ===');
  const res = (await db.collection('resumenesTarjeta').get()).docs.map(d => d.data() as any);
  console.log('  crudo del PDF        tarjetaCodigo       → canónico        vía');
  let cambian = 0;
  for (const r of res.sort((a, b) => String(a.banco).localeCompare(String(b.banco)))) {
    const { banco, via } = bancoCanonico(r, bancos, tarjetas);
    const antes = r.banco || null;
    if (antes !== banco) cambian++;
    const marca = antes !== banco ? '  ← CAMBIA' : '';
    console.log(`  ${String(antes).padEnd(20)} ${String(r.tarjetaCodigo).padEnd(19)} → ${String(banco).padEnd(15)} ${via}${marca}`);
  }
  console.log(`\n  resúmenes cuyo banco cambia al confirmarse: ${cambian} de ${res.length}`);
  const sinResolver = res.filter(r => bancoCanonico(r, bancos, tarjetas).via.startsWith('4'));
  console.log(`  que caen al default (loguean warn): ${sinResolver.length}`);

  // Estado de los datos tras la migración
  console.log('\n=== datos ===');
  const movs = (await db.collection('movimientos').get()).docs.map(d => d.data() as any);
  const cuenta = (f: (m: any) => boolean) => movs.filter(f).length;
  console.log(`  movimientos totales: ${movs.length}`);
  console.log(`  con banco === 'Efectivo':      ${cuenta(m => m.banco === 'Efectivo')} (esperado 0)`);
  console.log(`  con banco === 'Mercado Pago':  ${cuenta(m => m.banco === 'Mercado Pago')}`);
  const nombres = new Set(bancos.map(b => b.nombre));
  const fuera = movs.filter(m => m.banco != null && !nombres.has(m.banco));
  const porNombre = new Map<string, number>();
  for (const m of fuera) porNombre.set(m.banco, (porNombre.get(m.banco) ?? 0) + 1);
  console.log(`\n  DEUDA CONOCIDA — movimientos con banco fuera de config: ${fuera.length}`);
  for (const [k, n] of porNombre) console.log(`    "${k}": ${n}`);
  console.log('  (histórico; el fix de §3 es hacia adelante. Ver docs/CLAUDE.md → Medios de pago.)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
