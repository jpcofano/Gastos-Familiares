import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { parseMonto, formatMonto } from '../../utils/monto';

interface MoneyInputProps {
  value: number | null;
  onChange: (n: number | null) => void;
  moneda?: 'ARS' | 'USD';
  decimals?: number;
  placeholder?: string;
  id?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /**
   * Se llama con `true` cuando hay texto tipeado que no se pudo interpretar. Solo hace falta
   * donde el monto es OPCIONAL: ahí `null` por sí solo no distingue "campo vacío" de "escribió
   * algo ilegible", y sin esta señal lo segundo se guardaría como "sin monto" en silencio.
   */
  onInvalido?: (invalido: boolean) => void;
}

// MoneyInput — input de monto con formato es-AR. El padre trabaja siempre con
// `number | null`: el parseo vive acá adentro y nunca se filtra un string a la capa de datos.
//
// F9.107 D1 — se formatea al salir del campo, no mientras se tipea. La máscara viva
// reposiciona el caret en cada tecla y es inusable en Android/PWA.
// F9.107 D2 — sin símbolo de moneda adentro: el campo "Moneda" de al lado ya lo dice, y
// meterlo acá crea una segunda fuente de verdad ARS/USD.
export function MoneyInput({
  value,
  onChange,
  moneda,
  decimals = 2,
  placeholder = '0,00',
  id,
  required,
  autoFocus,
  disabled,
  style,
  onBlur,
  onKeyDown,
  onInvalido,
}: MoneyInputProps) {
  const [buffer, setBuffer] = useState(() => (value != null && Number.isFinite(value) ? formatMonto(value, decimals) : ''));
  const conFoco = useRef(false);

  // Resincronizar cuando el valor cambia desde afuera (preload de comprobante, reset del
  // form). Con el campo enfocado no se toca: pisaría lo que la persona está tecleando.
  useEffect(() => {
    if (conFoco.current) return;
    setBuffer(value != null && Number.isFinite(value) ? formatMonto(value, decimals) : '');
  }, [value, decimals]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={buffer}
      placeholder={placeholder}
      required={required}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={moneda ? `Monto en ${moneda}` : 'Monto'}
      onChange={e => {
        const texto = e.target.value;
        const n = parseMonto(texto);
        setBuffer(texto);
        onChange(n);
        onInvalido?.(n === null && texto.trim() !== '');
      }}
      onFocus={e => {
        conFoco.current = true;
        e.target.select(); // pisar el valor de un tirón (flujo de comprobante precargado)
      }}
      onBlur={() => {
        conFoco.current = false;
        const n = parseMonto(buffer);
        // Si no parseó se deja el texto crudo: la persona ve lo que escribió y lo corrige.
        if (n !== null) setBuffer(formatMonto(n, decimals));
        onBlur?.();
      }}
      onKeyDown={onKeyDown}
      style={{
        fontFamily: 'var(--font-num)',
        fontVariantNumeric: 'tabular-nums',
        textAlign: 'right',
        ...style,
      }}
    />
  );
}
