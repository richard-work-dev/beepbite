import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
import { hasAnyAccess } from '@/lib/access-control';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectPath?: string;
  loadingComponent?: React.ReactNode;
  capabilities?: string[];
}

const ProtectedRoute = ({
  children,
  redirectPath = '/signin',
  capabilities,
  loadingComponent = (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg text-muted-foreground">Verificando autorización...</div>
    </div>
  )
}: ProtectedRouteProps) => {
  const { user, loading, activeMembership, hasLoadedOrganizations } = useAuth();
  const { actor } = useActor();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    // Only redirect if we're sure loading is complete and user is not authenticated
    if (!loading && !user) {
      // Redirect to sign-in with the current location as state
      void navigate(redirectPath, {
        replace: true,
        state: { from: location }
      });
    }
  }, [user, loading, navigate, redirectPath]); // Removed location from dependencies

  // Show loading state while auth is being determined
  if (loading) {
    return loadingComponent;
  }

  // If no user and not loading, return null (redirect will happen in useEffect)
  if (!user) {
    return null;
  }

  if (capabilities?.length && (!hasLoadedOrganizations || !activeMembership) && !actor) {
    return loadingComponent;
  }

  const allowed = !capabilities?.length || hasAnyAccess(activeMembership, capabilities, actor?.capabilities);
  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6" aria-labelledby="access-denied-title">
        <section className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 id="access-denied-title" className="text-xl font-bold">No tenés acceso a esta pantalla</h1>
          <p className="text-sm text-muted-foreground">Ingresá con el perfil adecuado o pedile al encargado que revise tus permisos.</p>
          <button type="button" onClick={() => void navigate('/home', { replace: true })} className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Ir al inicio
          </button>
        </section>
      </main>
    );
  }

  // Only render children if user is authenticated
  return children;
};

export default ProtectedRoute;
