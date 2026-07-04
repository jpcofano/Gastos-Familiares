import {
  House, ListChecks, Upload, UserRound, ChevronLeft, X, Plus, CreditCard,
  Calendar, UsersRound, CalendarDays, Check,
  FileUp, CheckCheck, Loader, TriangleAlert, CircleX, ChevronRight, ChevronDown, ChevronUp,
  Bell, Palette, Tags, Wallet, Repeat, LogOut,
  Receipt, BarChart3, Tag, TrendingUp, Share2, AlertCircle, Moon, Sun, Layers,
  Store, FileText, GitCompare, List, CalendarCheck, Clock,
  Search, Trash2, Pencil, Download,
  BookOpen, Sparkles, PieChart, LayoutGrid, Landmark,
  FlaskConical, Zap, ToggleLeft, ToggleRight, Settings2,
  type LucideProps,
} from 'lucide-react';

// Mapa curado — agregar acá cada ícono nuevo que se use (named imports,
// tree-shakeable). NO importar el barrel `icons` de lucide-react: trae
// las ~1500 figuras del paquete entero y dispara el bundle (831KB → 1.65MB
// medido en F9.2 antes de este fix).
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  house: House,
  'list-checks': ListChecks,
  upload: Upload,
  'user-round': UserRound,
  'chevron-left': ChevronLeft,
  x: X,
  plus: Plus,
  'credit-card': CreditCard,
  calendar: Calendar,
  'users-round': UsersRound,
  'calendar-days': CalendarDays,
  check: Check,
  'file-up': FileUp,
  'check-check': CheckCheck,
  loader: Loader,
  'triangle-alert': TriangleAlert,
  'circle-x': CircleX,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  bell: Bell,
  palette: Palette,
  tags: Tags,
  wallet: Wallet,
  repeat: Repeat,
  'log-out': LogOut,
  receipt: Receipt,
  'bar-chart-3': BarChart3,
  tag: Tag,
  'trending-up': TrendingUp,
  'share-2': Share2,
  'alert-circle': AlertCircle,
  moon: Moon,
  sun: Sun,
  layers: Layers,
  store: Store,
  'file-text': FileText,
  'git-compare': GitCompare,
  list: List,
  'calendar-check': CalendarCheck,
  clock: Clock,
  search: Search,
  'trash-2': Trash2,
  pencil: Pencil,
  download: Download,
  'book-open': BookOpen,
  sparkles: Sparkles,
  'pie-chart': PieChart,
  'layout-grid': LayoutGrid,
  landmark: Landmark,
  'flask-conical': FlaskConical,
  zap: Zap,
  'toggle-left': ToggleLeft,
  'toggle-right': ToggleRight,
  'settings-2': Settings2,
};

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

// Wrapper sobre lucide-react: mismo API que el mock del design system
// (<Icon name="house" size={20} />, nombres kebab-case) pero con los
// componentes reales del paquete — no hace falta el hack DOM del mock
// (window.lucide.createIcons() reemplazando un <i>), que existe ahí solo
// porque ese preview corre sin bundler (CDN + babel-standalone).
export function Icon({ name, size = 20, color, style }: IconProps) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return <Cmp size={size} color={color ?? 'currentColor'} style={style} />;
}
