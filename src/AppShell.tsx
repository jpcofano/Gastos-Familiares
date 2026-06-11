import './AppShell.css';
import { signInConGoogle, signOutUsuario } from './auth';
import { useMiembro } from './hooks/useMiembro';

export default function AppShell() {
  const { estado, miembro, firebaseUser } = useMiembro();

  if (estado === 'cargando') {
    return (
      <div className="shell-center">
        <p>Cargando…</p>
      </div>
    );
  }

  if (estado === 'noAutenticado') {
    return (
      <div className="shell-center">
        <h1>Gastos Familiares</h1>
        <button className="btn-primary" onClick={() => signInConGoogle()}>
          Ingresar con Google
        </button>
      </div>
    );
  }

  if (estado === 'noAutorizado') {
    return (
      <div className="shell-center">
        <p>Tu cuenta <strong>{firebaseUser?.email}</strong> no pertenece a la familia.</p>
        <button className="btn-secondary" onClick={() => signOutUsuario()}>Salir</button>
      </div>
    );
  }

  return (
    <div className="shell-layout">
      <header className="shell-header">
        <span className="shell-header-title">Gastos Familiares</span>
        <span className="shell-header-user">{miembro!.nombre}</span>
        <button className="btn-secondary" onClick={() => signOutUsuario()}>Salir</button>
      </header>
      <main className="shell-content">
        <p className="shell-placeholder">Próximamente: Dashboard</p>
      </main>
    </div>
  );
}
