import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import './AppShell.css';
import { signInConGoogle, signOutUsuario } from './auth';
import { useMiembro } from './hooks/useMiembro';
import { MiembroContext } from './contexto/MiembroContext';
import { ItemsEsperadosProvider } from './contexto/ItemsEsperadosContext';
import { DiccionarioProvider }    from './contexto/DiccionarioContext';
import { AppBar, Screen, BottomNav, Fab, type BottomNavItem } from './design-system/shell';
import Dashboard from './vistas/Dashboard';
import Resumen from './vistas/Resumen';
import ConfigEsperados from './vistas/ConfigEsperados';
import Comprobantes from './vistas/Comprobantes';
import Perfil from './vistas/Perfil';
import Miembros from './vistas/perfil/Miembros';
import Categorias from './vistas/perfil/Categorias';
import MediosPago from './vistas/perfil/MediosPago';
import TipoCambio from './vistas/perfil/TipoCambio';

const NAV_ITEMS: BottomNavItem[] = [
  { to: '/',            label: 'Inicio',  icon: 'house',       end: true },
  { to: '/resumen',     label: 'Resumen', icon: 'list-checks' },
  { to: '/comprobantes',label: 'Cargar',  icon: 'upload' },
  { to: '/perfil',      label: 'Perfil',  icon: 'user-round' },
];

const TITULOS_PERFIL_SUB: Record<string, string> = {
  '/perfil/miembros':    'Miembros',
  '/perfil/categorias':  'Categorías',
  '/perfil/medios-pago': 'Medios de pago',
  '/perfil/tc':          'Tipo de cambio',
};

function tituloDeRuta(pathname: string, nombre: string): { title: string; sub?: string } {
  if (pathname === '/comprobantes')     return { title: 'Cargar', sub: 'Comprobantes y resúmenes' };
  if (pathname === '/resumen')          return { title: 'Resumen', sub: 'Gastos del mes' };
  if (pathname === '/perfil')           return { title: 'Tu Perfil', sub: 'Cuenta y configuración' };
  if (pathname === '/config-esperados') return { title: 'Pagos esperados' };
  if (TITULOS_PERFIL_SUB[pathname])     return { title: TITULOS_PERFIL_SUB[pathname] };
  return { title: `Hola, ${nombre}`, sub: 'Gastos Familiares' };
}

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
  const navItems = esAdmin ? NAV_ITEMS : NAV_ITEMS.filter(n => n.to !== '/resumen');

  return (
    <MiembroContext.Provider value={{ memberId: memberId!, miembro: miembro! }}>
    <DiccionarioProvider>
    <ItemsEsperadosProvider>
      <ShellFrame esAdmin={esAdmin} nombre={miembro!.nombre} navItems={navItems} />
    </ItemsEsperadosProvider>
    </DiccionarioProvider>
    </MiembroContext.Provider>
  );
}

function ShellFrame({ esAdmin, nombre, navItems }: { esAdmin: boolean; nombre: string; navItems: BottomNavItem[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { title, sub } = tituloDeRuta(location.pathname, nombre);
  const muestraFab = location.pathname === '/' || location.pathname === '/resumen';
  const vuelveAPerfil = location.pathname === '/config-esperados' || Boolean(TITULOS_PERFIL_SUB[location.pathname]);

  return (
    <div className="shell-phone">
      <AppBar
        title={title}
        sub={sub}
        onBack={vuelveAPerfil ? () => navigate('/perfil') : undefined}
      />
      <Screen>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {esAdmin && <Route path="/resumen" element={<Resumen />} />}
          {esAdmin && <Route path="/config-esperados" element={<ConfigEsperados />} />}
          <Route path="/comprobantes" element={<Comprobantes />} />
          <Route path="/perfil" element={<Perfil />} />
          {esAdmin && <Route path="/perfil/miembros" element={<Miembros />} />}
          {esAdmin && <Route path="/perfil/categorias" element={<Categorias />} />}
          {esAdmin && <Route path="/perfil/medios-pago" element={<MediosPago />} />}
          {esAdmin && <Route path="/perfil/tc" element={<TipoCambio />} />}
          <Route path="/tarjetas" element={<Navigate to="/comprobantes" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Screen>
      {muestraFab && <Fab onClick={() => navigate('/comprobantes')} />}
      <BottomNav items={navItems} />
    </div>
  );
}
