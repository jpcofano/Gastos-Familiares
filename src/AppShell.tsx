import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import './AppShell.css';
import { signInConGoogle, signOutUsuario } from './auth';
import { useMiembro } from './hooks/useMiembro';
import { MiembroContext } from './contexto/MiembroContext';
import { ItemsEsperadosProvider } from './contexto/ItemsEsperadosContext';
import { DiccionarioProvider }    from './contexto/DiccionarioContext';
import Dashboard from './vistas/Dashboard';
import Resumen from './vistas/Resumen';
import ConfigEsperados from './vistas/ConfigEsperados';
import Comprobantes from './vistas/Comprobantes';

export default function AppShell() {
  const { estado, memberId, miembro, firebaseUser } = useMiembro();

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

  const esAdmin = miembro!.rol === 'admin';

  return (
    <MiembroContext.Provider value={{ memberId: memberId!, miembro: miembro! }}>
    <DiccionarioProvider>
    <ItemsEsperadosProvider>
      <div className="shell-layout">
        <header className="shell-header">
          <span className="shell-header-title">Gastos Familiares</span>
          <nav className="shell-nav">
            <NavLink to="/" end className={({ isActive }) => 'shell-nav-link' + (isActive ? ' shell-nav-link--active' : '')}>
              Dashboard
            </NavLink>
            {esAdmin && (
              <NavLink to="/resumen" className={({ isActive }) => 'shell-nav-link' + (isActive ? ' shell-nav-link--active' : '')}>
                Resumen
              </NavLink>
            )}
            {esAdmin && (
              <NavLink to="/config-esperados" className={({ isActive }) => 'shell-nav-link' + (isActive ? ' shell-nav-link--active' : '')}>
                Esperados
              </NavLink>
            )}
            <NavLink to="/comprobantes" className={({ isActive }) => 'shell-nav-link' + (isActive ? ' shell-nav-link--active' : '')}>
              Carga
            </NavLink>
          </nav>
          <span className="shell-header-user">{miembro!.nombre}</span>
          <button className="btn-secondary" onClick={() => signOutUsuario()}>Salir</button>
        </header>
        <main className="shell-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/resumen" element={<Resumen />} />
            <Route path="/config-esperados" element={<ConfigEsperados />} />
            <Route path="/comprobantes" element={<Comprobantes />} />
            <Route path="/tarjetas" element={<Navigate to="/comprobantes" replace />} />
          </Routes>
        </main>
      </div>
    </ItemsEsperadosProvider>
    </DiccionarioProvider>
    </MiembroContext.Provider>
  );
}
