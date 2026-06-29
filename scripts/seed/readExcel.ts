import * as XLSX from 'xlsx';

export interface SheetData {
  historico:            any[];
  tcDiario:             any[];
  tarjetasResumen:      any[];
  tarjetasMovimientos:  any[];
  gastosEsperados:      any[];
  ingresosEsperados:    any[];
  diccionarioAprendido: any[];
  diccionario:          any[];
  diccionarioNorm:      any[];
  usuarios:             any[];
  // F9.43 — mail de calendario del legacy (Config!B4), usado para los eventos
  // de vencimiento en Google Calendar. Celda suelta, no una hoja tabular —
  // se lee directo por referencia de celda, no con sheet_to_json.
  calendarEmail:        string | null;
}

export function readExcel(path: string): SheetData {
  console.log(`   Leyendo ${path}...`);
  const wb = XLSX.readFile(path, { cellDates: true });

  const get = (name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`Hoja "${name}" no existe en el Excel`);
    return XLSX.utils.sheet_to_json(ws, { defval: null });
  };

  const configSheet = wb.Sheets['Config'];
  const calendarEmailRaw = configSheet?.['B4']?.v;
  const calendarEmail = typeof calendarEmailRaw === 'string' && calendarEmailRaw.includes('@')
    ? calendarEmailRaw.trim().toLowerCase()
    : null;

  const data: SheetData = {
    historico:            get('Historico'),
    tcDiario:             get('TC_Diario'),
    tarjetasResumen:      get('Tarjetas_Resumen'),
    tarjetasMovimientos:  get('Tarjetas_Movimientos'),
    gastosEsperados:      get('GastosEsperados'),
    ingresosEsperados:    get('IngresosEsperados'),
    diccionarioAprendido: get('Diccionario_Aprendido'),
    diccionario:          get('Diccionario'),
    diccionarioNorm:      get('Diccionario_Normalizacion'),
    usuarios:             get('Usuarios'),
    calendarEmail,
  };

  console.log(`   Historico: ${data.historico.length} filas`);
  console.log(`   TC_Diario: ${data.tcDiario.length} filas`);
  console.log(`   Tarjetas_Resumen: ${data.tarjetasResumen.length} filas`);
  console.log(`   Tarjetas_Movimientos: ${data.tarjetasMovimientos.length} filas`);
  console.log(`   Diccionario_Aprendido: ${data.diccionarioAprendido.length} filas`);
  console.log(`   Config!B4 (calendarEmail): ${data.calendarEmail ?? '(vacío o no es un email)'}\n`);
  return data;
}
