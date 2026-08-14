// F9.140 §3 — prueba del guard de §2 y del predicado único de §1, con casos CONSTRUIDOS A MANO.
//
// Por qué a mano: después de la limpieza del §0 no queda dato en producción que dispare el par
// imposible, así que un "0 casos encontrados" no probaría nada — probaría que no hay datos.
// Esto ejercita las dos funciones reales con entradas que sí lo disparan. In-memory, NO toca
// Firestore ni necesita credenciales.
//
// `movimientos.ts` arrastra el SDK de cliente (`import.meta.env` en firebase.ts), que no levanta
// bajo node, así que se bundlea — mismo patrón que scripts/auditF9128.ts. Se prueba la función
// REAL: replicarla acá probaría la copia, que es justo lo que este spec vino a eliminar.
//
// Uso (el bundle es temporal, no se commitea):
//   npx esbuild src/datos/movimientos.ts --bundle --format=esm --platform=node \
//     --define:import.meta.env='{}' --outfile=pago.bundle.mjs
//   npx tsx scripts/verificarF9140.ts
//   rm pago.bundle.mjs

// @ts-expect-error — bundle generado con esbuild para poder correrlo bajo node
import { marcarPago } from '../pago.bundle.mjs';
import { movimientoCubierto } from '../src/datos/checklist';

let fallos = 0;
function chequear(rotulo: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${rotulo.padEnd(52)} → ${JSON.stringify(real)}${ok ? '' : `  (esperado ${JSON.stringify(esperado)})`}`);
}

console.log('\n=== §1 — movimientoCubierto: las cuatro combinaciones ===');
chequear('pagado:false + confirmadoPago:false  → NO cubierto', movimientoCubierto({ pagado: false, confirmadoPago: false }), false);
chequear('pagado:true  + confirmadoPago:false  → cubierto',    movimientoCubierto({ pagado: true,  confirmadoPago: false }), true);
chequear('pagado:false + confirmadoPago:true   → cubierto',    movimientoCubierto({ pagado: false, confirmadoPago: true  }), true);
chequear('pagado:true  + confirmadoPago:true   → cubierto',    movimientoCubierto({ pagado: true,  confirmadoPago: true  }), true);
console.log('  ↑ la tercera es el caso de ITPA SA: antes de F9.140 la Card 1 lo daba por NO cubierto');
console.log('    (miraba solo `pagado`) y lo pintaba vencido en rojo. Ahora las dos pantallas coinciden.');

console.log('\n=== §2 — marcarPago: el guard corrige el par imposible y loguea ===');
console.log('  (el console.error de abajo es la evidencia de que el guard disparó, no un error del test)\n');
const corregido = marcarPago({ pagado: false, confirmadoPago: true, pagadoEn: 'X' }, 'writerDePrueba', 'mov-de-prueba');
console.log('');
chequear('confirmadoPago:true + pagado:false   → fuerza pagado', corregido, { pagado: true, confirmadoPago: true, pagadoEn: 'X' });

console.log('\n=== §2 — lo que el guard NO debe tocar ===');
chequear('pagado:true  + confirmadoPago:true    → intacto', marcarPago({ pagado: true,  confirmadoPago: true  }, 'w', 'm'), { pagado: true,  confirmadoPago: true  });
chequear('pagado:true  + confirmadoPago:false   → intacto', marcarPago({ pagado: true,  confirmadoPago: false }, 'w', 'm'), { pagado: true,  confirmadoPago: false });
chequear('pagado:false + confirmadoPago:false   → intacto', marcarPago({ pagado: false, confirmadoPago: false }, 'w', 'm'), { pagado: false, confirmadoPago: false });
console.log('  ↑ `pagado:true` sin confirmar es un estado VÁLIDO (lo deja un extracto importado):');
console.log('    el guard corrige una sola dirección, no "normaliza" los dos campos.');

console.log('\n=== §2 — EL CASO QUE IMPORTA: `pagado` AUSENTE, no `false` ===');
console.log('  El writer que produjo ITPA SA y Cons.Prop. escribía `{confirmadoPago:true,');
console.log('  pagadoEn:…}` sin mencionar `pagado`. Un guard que solo mirara el `false` explícito');
console.log('  NO habría visto ese update — de ahí que la condición sea `pagado !== true`.\n');
const reproduccionDelBugReal = marcarPago({ confirmadoPago: true, pagadoEn: 'X' }, 'confirmarRama1(pre-F9.138)', 'PHWX7clkikjA17bz4sst');
console.log('');
chequear('confirmadoPago:true SIN `pagado` → fuerza pagado', reproduccionDelBugReal, { confirmadoPago: true, pagadoEn: 'X', pagado: true });
chequear('solo pagado:false (sin confirmadoPago) → intacto', marcarPago({ pagado: false }, 'w', 'm'), { pagado: false });
console.log('  ↑ el segundo no se toca: sin `confirmadoPago:true` no hay invariante que aplicar.');

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`}\n`);
process.exit(fallos === 0 ? 0 : 1);
