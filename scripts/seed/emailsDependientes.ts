import type { SheetData } from './readExcel';

export const EMAILS_DEPENDIENTES: Record<string, string> = {
  'Federico': 'fedecofano1@gmail.com',
  'Sofía':    'sofiacofano@gmail.com',
};

export function inyectarEmailsDependientes(data: SheetData): void {
  for (const [persona, email] of Object.entries(EMAILS_DEPENDIENTES)) {
    if (email.startsWith('COMPLETAR_')) {
      throw new Error(`Falta completar el email de "${persona}" en EMAILS_DEPENDIENTES (emailsDependientes.ts)`);
    }
    const emailNorm = email.toLowerCase();
    const fila = (data.usuarios as any[]).find((u: any) => u.Persona === persona);
    if (fila) {
      fila.Email  = emailNorm;
      fila.Activo = true;
      fila.Rol    = fila.Rol === 'admin' ? 'admin' : 'dependiente';
    } else {
      (data.usuarios as any[]).push({ Persona: persona, Email: emailNorm, Activo: true, Rol: 'dependiente' });
    }
  }
}
