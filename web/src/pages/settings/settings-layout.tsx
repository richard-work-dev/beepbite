import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  MapPin,
  Tag,
  Globe,
  Truck,
  Heart,
  Key,
  Printer,
  ChefHat,
  UserCircle,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

interface SettingsNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  // Additional path prefixes this item explicitly claims own it (drill-downs).
  matchPaths?: string[];
}

interface SettingsSection {
  title: string;
  items: SettingsNavItem[];
}

const SECTIONS: SettingsSection[] = [
  {
    title: 'Negocio',
    items: [
      { label: 'Organización', to: '/settings/organization', icon: Building2 },
      {
        label: 'Locales',
        to: '/settings/organization?tab=locations',
        icon: MapPin,
        // Drill-down pages for a specific location (e.g. payments, settings)
        // are owned by this entry — they're navigated into FROM Locations.
        matchPaths: ['/settings/location/'],
      },
      { label: 'Dominios', to: '/settings/domains', icon: Globe },
    ],
  },
  {
    title: 'Tienda',
    items: [
      { label: 'Pedidos online', to: '/settings/online-ordering', icon: Globe },
      { label: 'Promociones', to: '/settings/promotions', icon: Tag },
      { label: 'Zonas de entrega', to: '/settings/delivery-zones', icon: Truck },
      { label: 'Fidelización', to: '/settings/loyalty', icon: Heart },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { label: 'Claves de API', to: '/settings/api-keys', icon: Key },
      { label: 'Hardware', to: '/settings/hardware', icon: Printer },
      { label: 'Rutas de cocina', to: '/settings/kitchen', icon: ChefHat },
    ],
  },
  {
    title: 'Tu perfil',
    items: [
      { label: 'Cuenta', to: '/account', icon: UserCircle },
    ],
  },
];

function isItemActive(item: SettingsNavItem, currentPath: string, currentSearch: string): boolean {
  // Any additional path prefixes the item explicitly claims own it (drill-downs).
  if (item.matchPaths?.some((p) => currentPath === p.replace(/\/$/, '') || currentPath.startsWith(p))) {
    return true;
  }
  const [base, query] = item.to.split('?');
  // Items that target a specific tab (?tab=...) must match BOTH the path
  // and the tab — otherwise multiple items sharing a base would all light up.
  if (query) {
    const params = new URLSearchParams(query);
    const current = new URLSearchParams(currentSearch);
    if (currentPath !== base) return false;
    for (const [k, v] of params) {
      if (current.get(k) !== v) return false;
    }
    return true;
  }
  // For plain-path items, hide when a more specific sibling owns the URL.
  // Example: Organization shouldn't light up on /settings/organization?tab=locations.
  if (currentPath === base) {
    return !currentSearch || !new URLSearchParams(currentSearch).get('tab');
  }
  // Nested pages still highlight their parent nav entry.
  return currentPath.startsWith(base + '/');
}

export default function SettingsLayout() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const flatItems = SECTIONS.flatMap((section) => section.items);
  const activeItem = flatItems.find(item => isItemActive(item, pathname, search));

  return (
    <PageContainer>
      <PageHeader
        icon={Settings2}
        title="Configuración"
        description="Configurá tu organización, la tienda y las integraciones del sistema."
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          className="sticky top-16 z-30 rounded-2xl border bg-card/95 p-3 backdrop-blur lg:hidden"
          aria-label="Navegación de configuración"
        >
          <label htmlFor="settings-section" className="mb-2 block text-xs font-semibold text-muted-foreground">¿Qué querés configurar?</label>
          <select id="settings-section" className="h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={activeItem?.to || ''} onChange={event => void navigate(event.target.value)}>
            {!activeItem && <option value="" disabled>Elegí una sección</option>}
            {SECTIONS.map(section => <optgroup key={section.title} label={section.title}>{section.items.map(item => <option key={item.to} value={item.to}>{item.label}</option>)}</optgroup>)}
          </select>
        </nav>

        {/* Sidebar */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
          <nav
            className="rounded-2xl border border-border/60 bg-card shadow-card p-3 space-y-1"
            aria-label="Navegación de configuración"
          >
            {SECTIONS.map((section, sIdx) => (
              <div key={section.title} className={cn(sIdx > 0 && 'pt-3')}>
                {/* Section divider line (except first) */}
                {sIdx > 0 && (
                  <div className="mb-3 h-px bg-border/50 mx-1" />
                )}
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(item, pathname, search);
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group flex min-h-11 items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-150',
                            active
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                              active
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground/70 group-hover:text-foreground'
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </PageContainer>
  );
}
