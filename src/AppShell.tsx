import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import './AppShell.css';
import { signInConGoogle, signOutUsuario } from './auth';
import { useMiembro } from './hooks/useMiembro';
import { MiembroContext } from './contexto/MiembroContext';
import { ItemsEsperadosProvider } from './contexto/ItemsEsperadosContext';
import { DiccionarioProvider }    from './contexto/DiccionarioContext';
import { AppBar, Screen, BottomNav, type BottomNavItem } from './design-system/shell';
import Dashboard from './vistas/Dashboard';
import Resumen from './vistas/Resumen';
import ConfigEsperados from './vistas/ConfigEsperados';
import Comprobantes from './vistas/Comprobantes';
import Perfil from './vistas/Perfil';
import MisDatos from './vistas/perfil/MisDatos';
import Miembros from './vistas/perfil/Miembros';
import Categorias from './vistas/perfil/Categorias';
import MediosPago from './vistas/perfil/MediosPago';
import TipoCambio from './vistas/perfil/TipoCambio';
import TarjetasConfig from './vistas/perfil/Tarjetas';
import TarjetasViewer from './vistas/TarjetasViewer';
import { Icon } from './design-system/Icon';

const NAV_ITEMS: BottomNavItem[] = [
  { to: '/',            label: 'Inicio',  icon: 'house',       end: true },
  { to: '/resumen',     label: 'Resumen', icon: 'list-checks' },
  { to: '/comprobantes',label: 'Cargar',  icon: 'upload' },
  { to: '/perfil',      label: 'Perfil',  icon: 'user-round' },
];

const TITULOS_PERFIL_SUB: Record<string, string> = {
  '/perfil/mis-datos':   'Mis datos',
  '/perfil/miembros':    'Miembros',
  '/perfil/categorias':  'Categorías',
  '/perfil/medios-pago': 'Medios de pago',
  '/perfil/tc':          'Tipo de cambio',
  '/perfil/tarjetas':    'Tarjetas',
};

function tituloDeRuta(pathname: string, nombre: string): { title: string; sub?: string } {
  if (pathname === '/comprobantes')     return { title: 'Cargar', sub: 'Comprobantes y resúmenes' };
  if (pathname === '/resumen')          return { title: 'Resumen', sub: 'Gastos del mes' };
  if (pathname === '/perfil')           return { title: 'Tu Perfil', sub: 'Cuenta y configuración' };
  if (pathname === '/config-esperados') return { title: 'Pagos esperados' };
  if (pathname === '/tarjetas')         return { title: 'Tarjetas', sub: 'Resúmenes (solo lectura)' };
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
  const vuelveAPerfil = location.pathname === '/config-esperados' || Boolean(TITULOS_PERFIL_SUB[location.pathname]);
  const onBack = vuelveAPerfil
    ? () => navigate('/perfil')
    : location.pathname === '/tarjetas' ? () => navigate('/resumen') : undefined;
  const right = location.pathname === '/resumen' && esAdmin
    ? (
      <button
        onClick={() => navigate('/tarjetas')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--gf-gray-100)', border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-strong)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
      >
        <Icon name="credit-card" size={15} /> Tarjetas
      </button>
    )
    : undefined;

  return (
    <div className="shell-phone">
      <AppBar title={title} sub={sub} onBack={onBack} right={right} />
      <Screen>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {esAdmin && <Route path="/resumen" element={<Resumen />} />}
          {esAdmin && <Route path="/config-esperados" element={<ConfigEsperados />} />}
          <Route path="/comprobantes" element={<Comprobantes />} />
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/perfil/mis-datos" element={<MisDatos />} />
          {esAdmin && <Route path="/perfil/miembros" element={<Miembros />} />}
          {esAdmin && <Route path="/perfil/categorias" element={<Categorias />} />}
          {esAdmin && <Route path="/perfil/medios-pago" element={<MediosPago />} />}
          {esAdmin && <Route path="/perfil/tc" element={<TipoCambio />} />}
          {esAdmin && <Route path="/perfil/tarjetas" element={<TarjetasConfig />} />}
          <Route path="/tarjetas" element={<TarjetasViewer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Screen>
      <BottomNav items={navItems} />
    </div>
  );
}
