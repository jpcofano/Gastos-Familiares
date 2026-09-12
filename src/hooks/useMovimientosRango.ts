import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { docAMovimiento } from '../datos/movimientos';
import type { Movement } from '../types';

// F9.171 §2 — mismo patrón que useMovimientosDelMes / useMovimientosDelAnio (F5.3, realtime),
// pero sobre un rango arbitrario de meses. Existe por la barra de ritmo de Resumen, que compara
// el mes en curso contra el promedio de los 6 anteriores.
//
// Por qué un hook nuevo y no `useMovimientosDelAnio`: una ventana de 6 meses cruza el año en
// la mitad de los casos (mirando marzo hay que leer octubre–diciembre del año anterior), así
// que con el hook anual harían falta DOS listeners de doce meses cada uno — hasta 24 meses de
// lecturas para usar 6. Resumen es la pantalla de entrada de la app; cuadruplicar sus lecturas
// para dibujar una barra no se paga. `mes` es 'YYYY-MM' lexicográfico, así que el rango
// funciona con >=/<= igual que en el hook anual.
//
// `mesDesde > mesHasta` devuelve vacío sin consultar: es cómo el caller apaga el hook (los
// hooks no se pueden llamar condicionalmente).
export function useMovimientosRango(mesDesde: string, mesHasta: string) {
  const [movimientos, setMovimientos] = useState<Movement[]>([]);
  const [cargando,    setCargando]    = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!mesDesde || !mesHasta || mesDesde > mesHasta) {
      setMovimientos([]);
      setCargando(false);
      setError(null);
      return;
    }
    setCargando(true);
    setError(null);
    const q = query(
      collection(db, 'movimientos'),
      where('mes', '>=', mesDesde),
      where('mes', '<=', mesHasta),
    );
    const unsub = onSnapshot(
      q,
      snap => {
        setMovimientos(snap.docs.map(d => docAMovimiento(d.id, d.data())));
        setCargando(false);
      },
      err => {
        setError(err.message);
        setCargando(false);
      },
    );
    return unsub;
  }, [mesDesde, mesHasta]);

  return { movimientos, cargando, error };
}
