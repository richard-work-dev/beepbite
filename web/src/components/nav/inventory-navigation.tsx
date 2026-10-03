import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PackageOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

const sections = [
  { title: 'Control', items: [{ name: 'Control diario', path: '/inventory/daily-counts' }, { name: 'Insumos', path: '/inventory/items' }, { name: 'Recetas', path: '/inventory/recipes' }] },
  { title: 'Compras', items: [{ name: 'Proveedores', path: '/inventory/suppliers' }, { name: 'Órdenes de compra', path: '/inventory/purchase-orders' }, { name: 'Reposición sugerida', path: '/inventory/purchase-orders/auto-suggestions' }, { name: 'Recepciones', path: '/inventory/grns' }, { name: 'Conciliar facturas', path: '/inventory/invoice-match' }] },
];

export default function InventoryNavigation() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const items = sections.flatMap(section => section.items);
  const active = items.filter(item => pathname === item.path || pathname.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  return <nav aria-label="Navegación de inventario" className="mb-5 min-w-0 rounded-2xl border bg-card p-3 sm:mb-6">
    <label htmlFor="inventory-section" className="mb-2 flex items-center gap-2 text-sm font-semibold"><PackageOpen className="h-4 w-4 text-primary" aria-hidden="true" />Inventario y compras</label>
    <select id="inventory-section" value={active?.path || ''} onChange={event => void navigate(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden">
      {!active && <option value="" disabled>Elegí una sección</option>}
      {sections.map(section => <optgroup key={section.title} label={section.title}>{section.items.map(item => <option key={item.path} value={item.path}>{item.name}</option>)}</optgroup>)}
    </select>
    <div className="hidden flex-wrap gap-1 lg:flex">{items.map(item => <Link key={item.path} to={item.path} aria-current={item.path === active?.path ? 'page' : undefined} className={cn('flex min-h-11 items-center rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', item.path === active?.path ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{item.name}</Link>)}</div>
  </nav>;
}
