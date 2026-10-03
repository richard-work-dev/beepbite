import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Users, ChevronDown, UserCircle, BarChart3, Hash, X, MapPin, ChefHat, CookingPot, Building2, Check, Store, Folder, Receipt, MonitorPlay, Truck, LockKeyhole, LayoutDashboard, PackageSearch, PackageOpen, ClipboardList, ClipboardCheck, PackageCheck, FileCheck2, Zap, Menu, LayoutGrid, CalendarDays, ListChecks, WalletCards, Gift, FileText, Clock3, ContactRound } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
import { hasAnyAccess } from '@/lib/access-control';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SyncStatusBadge } from "@/components/ui/sync-status";
import { cn } from "@/lib/utils";
import Logo from '@/components/ui/logo';

interface NavItem {
  name: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  capability?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const TopBar = () => {
  const { t } = useTranslation();
  const {
    user,
    userProfile,
    signOut,
    locations,
    activeLocation,
    switchLocation,
    organizations,
    activeOrganization,
    switchOrganization,
    activeMembership,
  } = useAuth();
  const { actor } = useActor();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);

  // Focus management for the side nav below — it's a hand-rolled panel (not
  // Radix Dialog, since it's a persistent drawer rather than a centered
  // modal), so the trap/restore/Escape behaviour Radix gives Dialog/Sheet
  // for free has to be wired up by hand here. This panel sits on every
  // authenticated page, so a missing trap here is a missing trap everywhere.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const sideNavRef = useRef<HTMLDivElement>(null);

  /**
   * Derive the best slug for /s/:slug staff-PIN login.
   * Prefer location-level slug if present, then org slug.
   * Fall back to /pos/login if neither is available.
   */
  const staffLoginPath = (() => {
    const slug = activeLocation?.slug || activeOrganization?.slug;
    return slug ? `/s/${slug}` : '/pos/login';
  })();

  // Check if we're on the landing page
  const isLandingPage = location.pathname === '/';

  const handleSignOut = async () => {
    try {
      await signOut();
      void navigate('/signin');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleSwitchLocation = (locationId: string) => {
    try {
      switchLocation(locationId);
    } catch (error) {
      console.error("Error switching location:", error);
    }
  };

  const getUserInitials = () => {
    if (!user?.email) return 'U';
    return user.email
      .split('@')[0]
      .split('.')
      .map(part => part[0]?.toUpperCase())
      .join('')
      .slice(0, 2);
  };

  const canAccess = (capability?: string) => {
    if (!capability) return true;
    return hasAnyAccess(activeMembership, [capability], actor?.capabilities, actor?.role);
  };

  const closeSideNav = () => {
    setIsSideNavOpen(false);
  };

  const toggleSideNav = (trigger?: HTMLButtonElement) => {
    if (trigger) menuTriggerRef.current = trigger;
    setIsSideNavOpen((open) => !open);
  };

  useEffect(() => {
    setIsSideNavOpen(false);
  }, [location.pathname, location.search]);

  // Escape closes the panel; Tab/Shift+Tab is trapped inside it while open
  // so a keyboard user can't tab into the (still-visible, click-blocked-only)
  // page content behind the backdrop. On close, focus returns to the avatar
  // button that opened it rather than being dropped back to <body>.
  useEffect(() => {
    if (!isSideNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = sideNavRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSideNav();
        return;
      }
      if (e.key !== 'Tab' || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      menuTriggerRef.current?.focus();
    };
  }, [isSideNavOpen]);

  // Top navigation items (2-3 most accessed)
  const topNavigationItems: NavItem[] = [
    { name: t('nav.topBar.home'), path: '/home', icon: Hash, description: t('nav.topBar.homeDesc') },
    { name: t('nav.topBar.pos'), path: '/pos/workspace', icon: Receipt, description: t('nav.topBar.posDesc'), capability: 'can_pos' },
    { name: t('nav.topBar.kitchen'), path: '/kds/expo', icon: MonitorPlay, description: t('nav.topBar.kitchenDesc'), capability: 'can_kds' },
    { name: t('nav.sideBar.reports'), path: '/reports', icon: BarChart3, description: t('nav.sideBar.reportsDesc'), capability: 'can_view_reports' },
  ];

  // Side navigation items (organized by category)
  const sideNavigationSections: NavSection[] = [
    {
      title: t('nav.sideBar.frontOfHouse'),
      items: [
        { name: t('nav.sideBar.posWorkspace'), path: '/pos/workspace', icon: Receipt, description: t('nav.sideBar.posWorkspaceDesc'), capability: 'can_pos' },
        { name: t('nav.sideBar.kitchenWorkspace'), path: '/work', icon: LayoutDashboard, description: t('nav.sideBar.kitchenWorkspaceDesc'), capability: 'can_kds' },
        { name: t('nav.sideBar.kitchenDisplay'), path: '/kds/expo', icon: MonitorPlay, description: t('nav.sideBar.kitchenDisplayDesc'), capability: 'can_kds' },
        { name: 'Salón y mesas', path: '/floor', icon: LayoutGrid, description: 'Estado y distribución de las mesas', capability: 'can_pos' },
        { name: 'Reservas', path: '/reservations', icon: CalendarDays, description: 'Agenda de reservas del local', capability: 'can_pos' },
        { name: 'Lista de espera', path: '/waitlist', icon: ListChecks, description: 'Clientes esperando una mesa', capability: 'can_pos' },
      ]
    },
    {
      title: t('nav.sideBar.operations'),
      items: [
        { name: t('nav.sideBar.reports'), path: '/reports', icon: BarChart3, description: t('nav.sideBar.reportsDesc'), capability: 'can_view_reports' },
        { name: 'Caja', path: '/cash', icon: WalletCards, description: 'Aperturas, cierres y movimientos', capability: 'can_pos' },
        { name: 'Facturas', path: '/invoices', icon: FileText, description: 'Comprobantes y facturación', capability: 'can_view_reports' },
        { name: 'Tarjetas de regalo', path: '/gift-cards', icon: Gift, description: 'Emisión, consulta y saldos', capability: 'can_pos' },
        { name: t('nav.sideBar.menu'), path: '/menu', icon: ChefHat, description: t('nav.sideBar.menuDesc'), capability: 'can_manage_menu' },
        { name: t('nav.sideBar.categories'), path: '/categories', icon: Folder, description: t('nav.sideBar.categoriesDesc'), capability: 'can_manage_menu' },
      ]
    },
    {
      title: 'Inventario y compras',
      items: [
        { name: 'Control diario', path: '/inventory/daily-counts', icon: ClipboardCheck, description: 'Conteo de apertura y cierre del día', capability: 'can_manage_menu' },
        { name: 'Insumos', path: '/inventory/items', icon: PackageOpen, description: 'Productos, unidades y stock mínimo', capability: 'can_manage_menu' },
        { name: 'Recetas de inventario', path: '/inventory/recipes', icon: CookingPot, description: 'Consumo automático por producto vendido', capability: 'can_manage_menu' },
        { name: 'Proveedores', path: '/inventory/suppliers', icon: PackageSearch, description: 'Contactos y condiciones de compra', capability: 'can_manage_menu' },
        { name: 'Órdenes de compra', path: '/inventory/purchase-orders', icon: ClipboardList, description: 'Pedidos y seguimiento a proveedores', capability: 'can_manage_menu' },
        { name: 'Reposición sugerida', path: '/inventory/purchase-orders/auto-suggestions', icon: Zap, description: 'Compras sugeridas por stock mínimo', capability: 'can_manage_menu' },
        { name: 'Recepciones', path: '/inventory/grns', icon: PackageCheck, description: 'Ingreso de mercadería y actualización de stock', capability: 'can_manage_menu' },
        { name: 'Conciliar facturas', path: '/inventory/invoice-match', icon: FileCheck2, description: 'Comparar factura, compra y recepción', capability: 'can_manage_menu' },
      ]
    },
    {
      title: t('nav.sideBar.team'),
      items: [
        { name: t('nav.sideBar.members'), path: '/members', icon: Users, description: t('nav.sideBar.membersDesc'), capability: 'can_manage_staff' },
        { name: t('nav.sideBar.staff'), path: '/staff', icon: UserCircle, description: t('nav.sideBar.staffDesc'), capability: 'can_manage_staff' },
        { name: 'Fichas del personal', path: '/staff/manage', icon: ContactRound, description: 'Perfil, seguridad, sueldo y horarios', capability: 'can_manage_staff' },
        { name: 'Control horario', path: '/timeclock', icon: Clock3, description: 'Entradas y salidas del personal', capability: 'can_manage_staff' },
        { name: t('nav.sideBar.driverPortal'), path: '/driver', icon: Truck, description: t('nav.sideBar.driverPortalDesc'), capability: 'can_drive' },
      ]
    },
    {
      title: t('nav.sideBar.settings'),
      items: [
        { name: t('nav.sideBar.orgSettings'), path: '/settings', icon: Building2, description: t('nav.sideBar.orgSettingsDesc') },
        { name: t('nav.sideBar.account'), path: '/account', icon: UserCircle, description: t('nav.sideBar.accountDesc') },
      ]
    }
  ];

  const availablePrimaryItems = topNavigationItems.filter((item) => canAccess(item.capability));
  const mobilePrimaryItems = availablePrimaryItems.filter((item) => ['/home', '/pos/workspace', '/reports'].includes(item.path));
  const availableNavItems = [
    ...availablePrimaryItems,
    ...sideNavigationSections.flatMap((section) => section.items.filter((item) => canAccess(item.capability))),
  ];
  const activeNavPath = availableNavItems
    .filter((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const isActivePath = (path: string) => activeNavPath === path;
  const isDocsPage = location.pathname === '/docs' || location.pathname.startsWith('/docs/');
  const showAppNavigation = Boolean(user && !isLandingPage && !isDocsPage);
  const isMoreActive = Boolean(activeNavPath && !mobilePrimaryItems.some((item) => item.path === activeNavPath));

  return (
    <>
      <header className={cn(
        'fixed top-0 left-0 right-0 z-50 border-b-2 transition-colors',
        isLandingPage
          ? 'border-border/60 bg-background/90 backdrop-blur-sm'
          : 'border-border bg-background',
      )}>
        <nav className="h-16 px-3 sm:px-5 lg:px-8 xl:px-12">
          <div className="h-full flex items-center justify-between max-w-content mx-auto">
            {/* Left: Logo and Navigation */}
            <div className="flex min-w-0 items-center gap-2 lg:gap-6">
              <Link to={user ? '/home' : '/'} className="flex min-w-0 items-center" aria-label="RikoPollo, inicio">
                <Logo variant="minimal" className="[&>span]:hidden min-[390px]:[&>span]:inline" />
              </Link>

              {/* Desktop Navigation - Show for authenticated users */}
              {user && (
                <nav className="hidden lg:flex items-center gap-0.5 lg:gap-1.5" aria-label="Navegación principal">
                  {availablePrimaryItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);

                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        title={item.name}
                        aria-label={item.name}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          "flex items-center gap-2 px-2 lg:px-3.5 py-2 sm:py-2.5 rounded-md text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="w-4 h-4 sm:w-[1.1rem] sm:h-[1.1rem]" aria-hidden="true" />
                        <span className="hidden lg:inline">{item.name}</span>
                      </Link>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => toggleSideNav(event.currentTarget)}
                    aria-expanded={isSideNavOpen}
                    aria-haspopup="dialog"
                    aria-label="Módulos"
                    title="Módulos"
                    className="ml-0 gap-2 px-2 lg:ml-1 lg:px-3"
                  >
                    <Menu className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden lg:inline">Módulos</span>
                  </Button>
                </nav>
              )}

            </div>

            {/* Right: Sync status, location, user menu */}
            <div className="flex items-center gap-2">
              {user ? (
                <>
                  {/* Sync status — always visible, not tucked in a menu. See
                      src/components/ui/sync-status.jsx: offline queueing is
                      real (src/offline/queue.js) and staff need to see it. */}
                  {!isLandingPage && <SyncStatusBadge className="hidden lg:inline-flex" />}

                  {/* Location Selector — also visible on tablets so the
                      current operating location is never hidden in a menu. */}
                  {!isLandingPage && (
                    <div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 w-10 justify-center p-0 text-sm font-medium flex items-center gap-2 sm:h-9 sm:w-auto sm:justify-start sm:px-3"
                            title={activeLocation?.name || t('nav.topBar.selectLocation')}
                          >
                            <MapPin className="h-4 w-4" aria-hidden="true" />
                            <span className="hidden max-w-[120px] truncate sm:inline">
                              {activeLocation?.name || t('nav.topBar.selectLocation')}
                            </span>
                            <ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>{t('nav.topBar.switchLocation')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {locations?.length > 0 ? (
                            locations.map((loc) => (
                              <DropdownMenuItem
                                key={loc.id}
                                onClick={() => handleSwitchLocation(loc.id)}
                                className={cn(
                                  "flex items-center gap-2 cursor-pointer",
                                  activeLocation?.id === loc.id && "bg-primary/10"
                                )}
                              >
                                {activeLocation?.id === loc.id && (
                                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                                )}
                                <Store className="h-4 w-4" aria-hidden="true" />
                                <span>{loc.name}</span>
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem disabled className="text-muted-foreground">
                              {t('nav.topBar.noLocations')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* User Menu Button */}
                  <Button
                    variant="outline"
                    className="h-11 w-11 rounded-md p-0"
                    aria-label={t('auth.openNavMenu')}
                    aria-expanded={isSideNavOpen}
                    onClick={(event) => toggleSideNav(event.currentTarget)}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={userProfile?.avatar_url ?? undefined} alt="" className="object-cover" />
                      <AvatarFallback className="bg-primary text-primary-foreground font-bold text-sm">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/signin')}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    {t('auth.signIn.title')}
                  </Button>
                  <Button
                    size="sm"
                    className="font-medium"
                    onClick={() => navigate('/signup')}
                  >
                    {t('auth.signUp.submitButton')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {showAppNavigation && (
        <nav
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-18px_rgba(0,0,0,0.45)] backdrop-blur lg:hidden"
          aria-label="Navegación principal móvil"
        >
          <div
            className="mx-auto grid h-16 max-w-xl"
            style={{ gridTemplateColumns: `repeat(${mobilePrimaryItems.length + 1}, minmax(0, 1fr))` }}
          >
            {mobilePrimaryItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={item.name}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    active ? 'text-primary' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="w-full truncate text-center">{item.name}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={(event) => toggleSideNav(event.currentTarget)}
              aria-expanded={isSideNavOpen}
              aria-haspopup="dialog"
              className={cn(
                'relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                isMoreActive || isSideNavOpen ? 'text-primary' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              {(isMoreActive || isSideNavOpen) && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
              <Menu className="h-5 w-5" aria-hidden="true" />
              <span>Más</span>
            </button>
          </div>
        </nav>
      )}

      {/* Side Navigation */}
      {user && isSideNavOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-[9998]"
            onClick={closeSideNav}
            aria-hidden="true"
          />

          {/* Side Navigation Panel */}
          <div
            ref={sideNavRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('auth.openNavMenu')}
            className="fixed inset-y-0 right-0 z-[9999] h-[100dvh] w-full max-w-sm animate-in border-l-2 border-border bg-background shadow-2xl slide-in-from-right duration-200"
          >
            <div className="h-full flex flex-col">

              {/* Header */}
              <div className="flex-shrink-0 bg-primary px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10 border-2 border-primary-foreground/40">
                      <AvatarImage src={userProfile?.avatar_url ?? undefined} alt="" />
                      <AvatarFallback className="bg-primary-foreground/20 text-primary-foreground font-bold">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-primary-foreground text-sm truncate font-semibold">
                        {user.email}
                      </p>
                      <p className="text-primary-foreground/75 text-xs truncate">
                        {activeLocation?.name || t('nav.topBar.selectLocation')}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={closeSideNav}
                    aria-label={t('common.close')}
                    className="text-primary-foreground hover:bg-primary-foreground/15 shrink-0"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </Button>
                </div>
                {/* Sync status repeated here — mobile users don't see the top-bar badge. */}
                <div className="mt-3 lg:hidden">
                  <SyncStatusBadge className="bg-primary-foreground/15 text-primary-foreground [&_svg]:text-primary-foreground" />
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto">
                <div className="space-y-6 p-4 sm:p-6">
                  {locations?.length > 0 && (
                    <div className="space-y-2 lg:hidden">
                      <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Local activo
                      </h3>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="h-auto w-full justify-start gap-3 px-3 py-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                              <MapPin className="h-[1.125rem] w-[1.125rem] text-primary" aria-hidden="true" />
                            </div>
                            <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                              {activeLocation?.name || t('nav.topBar.selectLocation')}
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-[50dvh] w-[calc(100vw-2rem)] max-w-[22rem] overflow-y-auto">
                          <DropdownMenuLabel>{t('nav.topBar.switchLocation')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {locations.map((loc) => (
                            <DropdownMenuItem
                              key={loc.id}
                              onClick={() => handleSwitchLocation(loc.id)}
                              className={cn('gap-2 py-3', activeLocation?.id === loc.id && 'bg-primary/10')}
                            >
                              {activeLocation?.id === loc.id ? <Check className="h-4 w-4 text-primary" /> : <Store className="h-4 w-4" />}
                              <span className="truncate">{loc.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  {sideNavigationSections.map((section) => (
                    <div key={section.title} className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                        {section.title}
                      </h3>
                      <div className="space-y-1">
                        {section.items.filter((item) => canAccess(item.capability)).map((item) => {
                          const Icon = item.icon;
                          const isActive = isActivePath(item.path);

                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              onClick={closeSideNav}
                              aria-current={isActive ? 'page' : undefined}
                              className={cn(
                                "flex items-center gap-3.5 px-3 py-2.5 rounded-md font-medium transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "text-foreground hover:bg-muted"
                              )}
                            >
                              <div className={cn(
                                "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                                isActive ? "bg-primary-foreground/20" : "bg-muted"
                              )}>
                                <Icon className={cn(
                                  "w-[1.125rem] h-[1.125rem]",
                                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                                )} aria-hidden="true" />
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-sm font-semibold truncate">{item.name}</span>
                                <span className={cn(
                                  "text-xs truncate",
                                  isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                                )}>{item.description}</span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Organization Selector */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                      {t('nav.sideBar.organization')}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full h-auto py-3 px-3 flex items-center gap-3 justify-start"
                        >
                          <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="w-[1.125rem] h-[1.125rem] text-primary" aria-hidden="true" />
                          </div>
                          <div className="flex flex-col items-start flex-1 min-w-0">
                            <span className="text-sm font-semibold truncate w-full text-left">
                              {activeOrganization?.name || t('nav.sideBar.organization')}
                            </span>
                            <span className="text-xs text-muted-foreground truncate w-full text-left">
                              {t('nav.sideBar.currentOrganization')}
                            </span>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-[60dvh] w-[calc(100vw-2rem)] max-w-80 overflow-y-auto" sideOffset={8}>
                        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {t('nav.sideBar.yourOrganizations')}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          {organizations?.length > 0 ? (
                            organizations.map((organization) => (
                              <DropdownMenuItem
                                key={organization.id}
                                onClick={() => switchOrganization(organization.id)}
                                className={cn(
                                  "flex items-center gap-3 py-3",
                                  activeOrganization?.id === organization.id ? "bg-primary/10 text-primary" : ""
                                )}
                              >
                                <div className={cn(
                                  "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                                  activeOrganization?.id === organization.id ? "bg-primary" : "bg-muted"
                                )}>
                                  <Building2 className={cn(
                                    "w-[1.125rem] h-[1.125rem]",
                                    activeOrganization?.id === organization.id ? "text-primary-foreground" : "text-muted-foreground"
                                  )} aria-hidden="true" />
                                </div>
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="font-medium truncate">{organization.name}</span>
                                </div>
                                {activeOrganization?.id === organization.id && (
                                  <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                                )}
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem disabled className="flex items-center gap-3 py-3 text-muted-foreground">
                              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                                <Building2 className="w-[1.125rem] h-[1.125rem] text-muted-foreground" aria-hidden="true" />
                              </div>
                              <div className="flex flex-col flex-1">
                                <span className="font-medium">{t('nav.sideBar.noOrganizations')}</span>
                                <span className="text-xs text-muted-foreground">{t('nav.sideBar.noOrganizationsHint')}</span>
                              </div>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              {/* Fixed Bottom — Staff login + Sign Out */}
              <div className="flex-shrink-0 space-y-1.5 border-t-2 border-border bg-muted/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {/* Staff / employee PIN login — shared-terminal "switch user" */}
                <button
                  type="button"
                  onClick={() => {
                    closeSideNav();
                    void navigate(staffLoginPath);
                  }}
                  className="flex w-full items-center gap-3.5 rounded-md px-3 py-3 text-primary hover:bg-primary/10 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <LockKeyhole className="w-[1.125rem] h-[1.125rem] text-primary" aria-hidden="true" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{t('nav.sideBar.staffLogin')}</div>
                    <div className="text-xs text-primary/75 truncate">{t('nav.sideBar.staffLoginHint')}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    // handleSignOut() is fully try/catch-wrapped above.
                    void handleSignOut();
                    closeSideNav();
                  }}
                  className="flex w-full items-center gap-3.5 rounded-md px-3 py-3 text-destructive hover:bg-destructive/10 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                >
                  <div className="w-9 h-9 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
                    <LogOut className="w-[1.125rem] h-[1.125rem] text-destructive" aria-hidden="true" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{t('auth.signOut')}</div>
                    <div className="text-xs text-destructive/75 truncate">{t('auth.signOutHint')}</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default TopBar;
