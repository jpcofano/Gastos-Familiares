import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

function isoDate(d: Date): string { return d.toISOString().slice(0,10); }
function mesYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

interface TCMap { [iso: string]: number; }

function buildTCMap(tcRows: any[]): TCMap {
  const map: TCMap = {};
  for (const r of tcRows) {
    if (r.Fecha && r.TC_USDARS) map[isoDate(r.Fecha as Date)] = Number(r.TC_USDARS);
  }
  return map;
}

function tcForDate(map: TCMap, fecha: Date): number | null {
  const target = isoDate(fecha);
  if (map[target]) return map[target];
  const sortedDates = Object.keys(map).sort();
  // Buscar TC más cercano hacia atrás
  let best: string | null = null;
  for (const d of sortedDates) {
    if (d <= target) best = d; else break;
  }
  if (best) return map[best];
  // Fallback hacia adelante: usar el TC más antiguo disponible
  // (caso típico: movement legacy anterior al primer TC registrado)
  return sortedDates.length > 0 ? map[sortedDates[0]] : null;
}

function inferSubtipo(r: any): { subtipo: string; origen: string } {
  if (r.Subtipo && r.Origen) return { subtipo: r.Subtipo, origen: r.Origen };
  const cat = r['Categoría'] ?? r.Categoria;
  if (cat === 'Tarjetas') return { subtipo: 'TarjetaPago', origen: 'WebApp' };
  return { subtipo: 'EventualDirecto', origen: 'WebApp' };
}

export async function seedMovements(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> movements');

  const tcMap = buildTCMap(data.tcDiario);
  let descartados = 0;
  let tcRelleno = 0;
  let subtipoInferido = 0;

  const docs = data.historico
    .filter(r => {
      if (!r.Fecha && (!r.Monto || r.Monto === 0)) { descartados++; return false; }
      return true;
    })
    .map(r => {
      const fecha = r.Fecha as Date;
      const { subtipo, origen } = inferSubtipo(r);
      if (!r.Subtipo) subtipoInferido++;

      let tcUsdArs: number | null = typeof r.TC_USDARS === 'number' ? r.TC_USDARS : null;
      if (tcUsdArs === null && fecha) {
        tcUsdArs = tcForDate(tcMap, fecha);
        if (tcUsdArs !== null) tcRelleno++;
      }
      const idBase = r.ID;
      const fechaISO = fecha.toISOString().slice(0, 10);
      const idFinal = `${idBase}_${fechaISO}`;
      return {
        id: idFinal,
        idLegacy: idBase,  
        fecha: Timestamp.fromDate(fecha),
        fechaConsumoOriginal: r.FechaConsumoOriginal
          ? Timestamp.fromDate(r.FechaConsumoOriginal as Date) : null,
        mes: mesYYYYMM(fecha),
        descripcion: r['Descripción'] ?? r.Descripcion ?? '',
        descripcionOriginal: null,
        monto: Number(r.Monto ?? 0),
        moneda: (r.Moneda === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
        tcUsdArs,
        tipo: r.Tipo as 'Gasto' | 'Ingreso',
        subtipo,
        origen,
        categoria: r['Categoría'] ?? r.Categoria ?? null,
        subcategoria: r.Subcategoria ?? null,
        etiqueta: r.Etiqueta ?? null,
        banco: r.Banco ?? null,
        cuenta: r.Cuenta ?? null,
        tarjetaCodigo: null,
        tarjeta: r.Tarjeta ?? null,
        persona: r.Persona ?? null,
        creadoPor: r.Usuario ?? 'Sistema',
        pagado: r.Pagado === true,
        excluirDash: r.ExcluirDash === true,
        incluirResumenMes: r.FlagResumenMes === true,
        parentId: r.ParentID ?? null,
        cardStatementId: r.ResumenTarjetaID ?? null,
        expectedItemId: null,
        numeroComprobante: r.NumeroComprobante ?? null,
        pdfHash: null,
        pdfStorageRef: null,
        notas: r.Notas ?? null,
        createdAt: r.CreatedAt ? Timestamp.fromDate(r.CreatedAt as Date) : Timestamp.fromDate(fecha),
        updatedAt: r.UpdatedAt ? Timestamp.fromDate(r.UpdatedAt as Date) : Timestamp.fromDate(fecha),
      };
    })
    .map(d => {
      if (d.etiqueta && TECNICA_RE.test(d.etiqueta)) {
        return { ...d, etiqueta: null };
      }
      return d;
    });

  console.log(`   ${docs.length} movimientos (${descartados} descartados)`);
  console.log(`   ${subtipoInferido} subtipos inferidos (OBL- legacy)`);
  console.log(`   ${tcRelleno} TC rellenados desde tcDaily`);
  if (dryRun) return;
  await writeBatch(db, 'movements', docs);
  console.log('   OK\n');
}
