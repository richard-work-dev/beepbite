import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopBar from '../nav/top-bar';
import { onMissingCapability } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

const MainLayout = () => {
  const location = useLocation();
  const { toast } = useToast();

  // Global handler: whenever the server returns 403 missing_capability, show a toast.
  useEffect(() => {
    const unsub = onMissingCapability((capability) => {
      toast({
        variant: 'destructive',
        title: 'Permiso requerido',
        description: `Necesitás el permiso ${capability}. Consultá con un encargado.`,
      });
    });
    return () => { unsub(); };
  }, [toast]);
  const isLandingPage = location.pathname === '/';
  const isDocsPage = location.pathname === '/docs' || location.pathname.startsWith('/docs/');
  const isFullBleed = isLandingPage || isDocsPage;
  const isWorkspace = location.pathname === '/work';

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />

      <div className={`flex flex-1 ${isLandingPage ? '' : `mt-16`}`}>
        {isFullBleed ? (
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        ) : isWorkspace ? (
          <main className="min-w-0 flex-1 bg-background">
            <div className="h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-4rem)]">
              <Outlet />
            </div>
          </main>
        ) : (
          <main className="min-w-0 flex-1 bg-muted/40 px-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-5 lg:pb-0 lg:px-8 xl:px-12">
            <div className="mx-auto w-full max-w-content py-4 sm:py-6 lg:py-8">
              <Outlet />
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default MainLayout;
