// F9.196 — lectura del archivo local de credenciales de las exploraciones en vivo (PPI, Bitfinex).
// `%OneDrive%\.secrets\gastos-familiares.env`, fuera del repo. Sin dependencias (sin npm install).
//
// ⛔ Quien use estos valores NUNCA los imprime, ni completos ni recortados, ni los pasa a otro proceso
// o agente.
import * as fs from 'fs';
import * as path from 'path';

/** Ruta del archivo de credenciales: `%OneDrive%\.secrets\gastos-familiares.env`. */
export const rutaSecretos = () => path.join(process.env.OneDrive ?? '', '.secrets', 'gastos-familiares.env');

/**
 * Parser mínimo de `.env`: `clave=valor`, ignora vacías y `#`, saca comillas y espacios de los
 * costados. Devuelve los valores; quien llama NUNCA los imprime.
 */
export function parsearEnv(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) continue;
    const i = linea.indexOf('=');
    if (i <= 0) continue;
    const clave = linea.slice(0, i).trim();
    let valor = linea.slice(i + 1).trim();
    if (valor.length >= 2 && ((valor[0] === '"' && valor.endsWith('"')) || (valor[0] === "'" && valor.endsWith("'")))) {
      valor = valor.slice(1, -1).trim();
    }
    out[clave] = valor;
  }
  return out;
}

export function leerEnv(ruta: string): Record<string, string> {
  return parsearEnv(fs.readFileSync(ruta, 'utf8'));
}

/**
 * Lee el archivo y verifica que estén las variables pedidas. Si falta alguna, termina el proceso
 * diciendo CUÁL (nunca su valor).
 */
export function exigirEnv(requeridas: string[]): Record<string, string> {
  const ruta = rutaSecretos();
  if (!process.env.OneDrive || !fs.existsSync(ruta)) {
    console.error('[env] no encuentro %OneDrive%\\.secrets\\gastos-familiares.env');
    process.exit(2);
  }
  const env = leerEnv(ruta);
  const faltan = requeridas.filter(k => !env[k]);
  if (faltan.length) {
    console.error(`[env] faltan variables (sin valor o ausentes): ${faltan.join(', ')}`);
    process.exit(2);
  }
  return env;
}
