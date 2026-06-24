import { NavLink } from 'react-router-dom';
import { Icon } from '../Icon';

export interface BottomNavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

export function BottomNav({ items }: BottomNavProps) {
  return (
    <div style={{
      flex: '0 0 auto', height: 64, background: '#fff', borderTop: '1px solid var(--gf-gray-150)',
      display: 'flex', alignItems: 'stretch', position: 'relative', zIndex: 2,
    }}>
      {items.map(n => (
        <NavLink key={n.to} to={n.to} end={n.end} style={{ flex: 1, textDecoration: 'none' }}>
          {({ isActive }) => (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 4,
              color: isActive ? 'var(--color-accent)' : 'var(--gf-gray-400)', fontFamily: 'var(--font-base)',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 52, height: 30, borderRadius: 999,
                background: isActive ? 'var(--gf-emerald-50)' : 'transparent',
                transition: 'background .18s ease',
              }}>
                <Icon name={n.icon} size={21} />
              </span>
              <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500 }}>{n.label}</span>
            </div>
          )}
        </NavLink>
      ))}
    </div>
  );
}
