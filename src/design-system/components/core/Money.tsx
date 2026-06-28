import type { HTMLAttributes } from 'react';

interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  value: number | string | null | undefined;
  currency?: 'ARS' | 'USD';
  tipo?: 'Ingreso' | 'Gasto' | null;
  colored?: boolean;
  signed?: boolean;
  size?: string;
  decimals?: number;
}

function formatAmount(value: number | string | null | undefined, currency: 'ARS' | 'USD', decimals: number): string {
  const n = Number(value) || 0;
  const symbol = currency === 'USD' ? 'U$S' : '$';
  const body = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${symbol} ${body}`;
}

// Money — renderiza un monto a la manera Gastos Familiares: formato es-AR
// ($ 1.234,56 / U$S 1.234,56), tabular-nums, color+signo ingreso/gasto si
// se pasa `tipo`.
export function Money({
  value,
  currency = 'ARS',
  tipo = null,
  colored = true,
  signed = true,
  size,
  decimals = 2,
  style,
  ...rest
}: MoneyProps) {
  const isIncome = tipo === 'Ingreso';
  const isExpense = tipo === 'Gasto';
  const sign = signed && tipo ? (isIncome ? '+' : '−') : '';
  const color = colored && isIncome ? 'var(--color-income)' : colored && isExpense ? 'var(--color-expense)' : 'inherit';
  return (
    <span
      style={{
        fontFamily: 'var(--font-num)',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 'var(--weight-semibold)',
        whiteSpace: 'nowrap',
        color,
        fontSize: size,
        ...style,
      }}
      {...rest}
    >
      {sign}{formatAmount(value, currency, decimals)}
    </span>
  );
}
