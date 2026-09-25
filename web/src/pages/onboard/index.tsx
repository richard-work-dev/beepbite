/**
 * Onboarding wizard — /onboard
 *
 * A six-step resumable setup guide for new organisations:
 *   0  Verify email
 *   1  Create first store (location)
 *   2  Add 5 menu items
 *   3  Invite staff / driver
 *   4  Connect payment provider or set on-delivery
 *   5  Ship a test order
 *
 * Progress is persisted per-org via PUT /onboarding/progress after every step
 * advance, and resumed on load via GET /onboarding/progress.
 * Real completion state is checked via GET /onboarding/status so the wizard
 * reflects actual DB state, not just what the user clicked.
 *
 * Each step delegates action to EXISTING routes / endpoints — this wizard
 * provides navigation and progress tracking only; it does not re-implement
 * data creation logic.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  Mail,
  MapPin,
  UtensilsCrossed,
  Users,
  ShoppingBag,
  Loader2,
  ExternalLink,
  Sparkles,
  RefreshCw,
  BookOpen,
  Store,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useAuth } from '@/context/auth-context';
import { normalizeServiceStyle, type ServiceStyle } from '@/lib/service-style';
import { supabase } from '@/services/supabase-client';
import { getProgress, putProgress, getStatus } from '@/services/onboarding';
import type { OnboardingStatus } from '@/services/onboarding';

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface Step {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  hint: string;
  actionLabel: string | null;
  actionPath: string | null;
  statusKey: keyof OnboardingStatus | null;
  isServiceStyleStep?: boolean;
}

const STEPS: Step[] = [
  {
    key: 'email',
    icon: Mail,
    title: 'Verificá tu correo',
    description:
      'Confirmá tu correo para recibir avisos importantes sobre tu cuenta.',
    hint: 'Buscá en tu bandeja de entrada el enlace de verificación de BeepBite. Después, continuá al siguiente paso.',
    actionLabel: null,
    actionPath: null,
    statusKey: null,
  },
  {
    key: 'location',
    icon: MapPin,
    title: 'Creá tu primer local',
    description:
      'Agregá un local físico, una cocina o un punto de atención para comenzar a recibir pedidos.',
    hint: 'Andá a Configuración → Locales → Agregar local. Completá el nombre, identificador y ciudad.',
    actionLabel: 'Ir a Configuración',
    actionPath: '/settings',
    statusKey: 'has_location',
  },
  {
    key: 'service_style',
    icon: Store,
    title: '¿Cómo atendés a tus clientes?',
    description:
      'Elegí la modalidad del local para que BeepBite muestre sólo las funciones que necesitás.',
    hint: 'Podés cambiarla más adelante en Configuración → Local → Estado.',
    actionLabel: null,
    actionPath: null,
    statusKey: null,
    isServiceStyleStep: true,
  },
  {
    key: 'menu',
    icon: UtensilsCrossed,
    title: 'Agregá 5 productos al menú',
    description:
      'Agregá comidas, bebidas, productos o servicios. Necesitás al menos 5 productos activos para comenzar a vender.',
    hint: 'Andá a Menú → Categorías, creá una categoría y agregá productos con nombre y precio.',
    actionLabel: 'Ir al Menú',
    actionPath: '/menu',
    statusKey: 'has_five_items',
  },
  {
    key: 'staff',
    icon: Users,
    title: 'Invitá a un empleado o repartidor',
    description:
      'Agregá al menos una persona para tomar pedidos, gestionar la cocina o hacer entregas.',
    hint: 'Andá a Personal → Agregar empleado e ingresá su nombre y PIN. Para repartidores usá la sección Repartidores.',
    actionLabel: 'Ir a Personal',
    actionPath: '/staff',
    statusKey: 'has_staff_or_driver',
  },
  {
    key: 'order',
    icon: ShoppingBag,
    title: 'Completá un pedido de prueba',
    description:
      'Abrí el punto de venta, agregá productos y completá una venta para confirmar que todo funciona.',
    hint: 'Abrí el punto de venta desde el menú lateral, elegí productos, seleccioná un método de pago y completá el pedido.',
    actionLabel: 'Abrir punto de venta',
    actionPath: '/pos',
    statusKey: 'has_order',
  },
];

// ---------------------------------------------------------------------------
// Hook: load + persist progress
// ---------------------------------------------------------------------------

function useOnboardingProgress() {
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // getProgress() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) throws instead.
    // Without this try/catch/finally, that left the onboarding wizard
    // stuck on its initial loading screen forever with the rejection
    // silently swallowed.
    (async () => {
      try {
        const { data, error } = await getProgress();
        if (!cancelled && !error && data) {
          setStep(data.step ?? 0);
          setCompletedSteps(data.completed_steps ?? []);
        }
      } catch (err) {
        console.error('Error loading onboarding progress:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    // getStatus() has the same failure mode as getProgress() above: a
    // network-level rejection left `statusLoading` stuck true forever.
    try {
      const { data, error } = await getStatus();
      if (!error && data) {
        setStatus(data);
      }
      return data;
    } catch (err) {
      console.error('Error loading onboarding status:', err);
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      void refreshStatus();
    }
  }, [loading, refreshStatus]);

  const advanceTo = useCallback(async (newStep: number, newCompleted: string[]) => {
    setSaving(true);
    const { data, error } = await putProgress({
      step: newStep,
      completed_steps: newCompleted,
    });
    if (!error && data) {
      setStep(data.step);
      setCompletedSteps(data.completed_steps ?? []);
    }
    setSaving(false);
    return !error;
  }, []);

  return {
    step,
    completedSteps,
    status,
    loading,
    saving,
    statusLoading,
    advanceTo,
    refreshStatus,
  };
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

/** Shared brand mark used in the loading screen */
function BrandMark() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/90 flex items-center justify-center shadow">
          <img src="/icon.svg" alt="" aria-hidden="true" className="w-7 h-7 filter brightness-0 invert" />
        </div>
        <span aria-hidden="true" className="absolute -top-1 -right-1 w-3 h-3 bg-destructive rounded-full border-2 border-background animate-pulse" />
      </div>
      <p className="text-lg font-bold tracking-tight leading-none">
        <span className="text-primary">Beep</span><span className="text-foreground">Bite</span>
      </p>
    </div>
  );
}

/** Step number badge in the sidebar list */
function StepBadge({ index, done, isCurrent }: { index: number; done: boolean; isCurrent: boolean }) {
  if (done) {
    return (
      <span className="w-6 h-6 rounded-full flex items-center justify-center bg-beepbite-success/10 shrink-0">
        <CheckCircle2 className="w-4 h-4 text-beepbite-success" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border',
        isCurrent
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-muted-foreground border-border'
      )}
      aria-hidden="true"
    >
      {index + 1}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Wizard page component
// ---------------------------------------------------------------------------

export default function OnboardPage() {
  const navigate = useNavigate();
  const { activeOrganization, locations, fetchLocations } = useAuth();

  // Service style for the first location
  const firstLocation = locations?.[0];
  const firstLocationId = firstLocation?.id;
  const [serviceStyle, setServiceStyleState] = useState<ServiceStyle | null>(() =>
    normalizeServiceStyle(firstLocation?.service_style)
  );
  useEffect(() => {
    setServiceStyleState(normalizeServiceStyle(firstLocation?.service_style));
  }, [firstLocation?.service_style]);

  const handlePickServiceStyle = useCallback(async (style: ServiceStyle) => {
    if (!firstLocationId) return;
    const { error } = await supabase.from('locations').update({ service_style: style }).eq('id', firstLocationId);
    if (error) {
      console.error('No se pudo guardar la modalidad de atención:', error);
      return;
    }
    setServiceStyleState(style);
    await fetchLocations();
  }, [fetchLocations, firstLocationId]);

  const serviceStyleChosen = serviceStyle === 'dine_in' || serviceStyle === 'takeaway';

  const {
    step,
    completedSteps,
    status,
    loading,
    saving,
    statusLoading,
    advanceTo,
    refreshStatus,
  } = useOnboardingProgress();

  const isStepDone = useCallback(
    (stepKey: string | undefined, stepIndex: number) => {
      if (stepKey === 'email') return true;
      if (stepKey === 'service_style') return serviceStyleChosen;
      const def = STEPS[stepIndex];
      if (def.statusKey && status) {
        return !!status[def.statusKey];
      }
      return !!stepKey && completedSteps.includes(stepKey);
    },
    [status, completedSteps, serviceStyleChosen]
  );

  const doneCount = STEPS.filter((s, i) => isStepDone(s.key, i)).length;
  const totalCount = STEPS.length;
  const progressPct = Math.round((doneCount / totalCount) * 100);
  const allDone = doneCount === totalCount;

  const handleMarkDoneAndNext = useCallback(async () => {
    const currentKey = STEPS[step]?.key;
    const newCompleted = completedSteps.includes(currentKey)
      ? completedSteps
      : [...completedSteps, currentKey];
    const nextStep = Math.min(step + 1, totalCount - 1);
    await advanceTo(nextStep, newCompleted);
    await refreshStatus();
  }, [step, completedSteps, advanceTo, refreshStatus, totalCount]);

  const handleBack = useCallback(async () => {
    const prevStep = Math.max(step - 1, 0);
    await advanceTo(prevStep, completedSteps);
  }, [step, completedSteps, advanceTo]);

  const handleJumpTo = useCallback(async (idx: number) => {
    await advanceTo(idx, completedSteps);
  }, [completedSteps, advanceTo]);

  const handleNavigate = useCallback((path: string) => {
    void navigate(path);
  }, [navigate]);

  // ── Loading screen ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-muted via-background to-primary/5">
        <BrandMark />
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
          Cargando el progreso de la configuración…
        </div>
      </div>
    );
  }

  const currentStepDef = STEPS[step];
  const StepIcon = currentStepDef?.icon || Sparkles;
  const stepDone = isStepDone(currentStepDef?.key, step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/5 pt-6 pb-16 px-4">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* ── Hero / progress card ─────────────────────────────────────────── */}
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-primary to-primary/90 text-primary-foreground relative">
            {/* Decorative circle */}
            <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 rounded-full bg-primary-foreground/10 -translate-y-1/2 translate-x-1/4" />

            <div className="relative p-6 sm:p-8">
              {/* Header row */}
              <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Sparkles className="w-5 h-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold leading-snug">
                    {allDone
                      ? `¡${activeOrganization?.name || 'Tu negocio'} está listo!`
                      : `Configurá ${activeOrganization?.name || 'tu negocio'}`}
                  </h1>
                  <p className="text-primary-foreground/80 text-sm mt-0.5">
                    {allDone
                      ? 'Completaste todos los pasos. Ya podés recibir pedidos.'
                      : 'Completá cada paso para dejar BeepBite listo para trabajar.'}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-primary-foreground/80">Progreso de configuración</span>
                  <span className="font-semibold tabular-nums">
                    {doneCount} / {totalCount} completos
                  </span>
                </div>
                <div
                  className="h-2.5 rounded-full bg-primary-foreground/25 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={doneCount}
                  aria-valuemin={0}
                  aria-valuemax={totalCount}
                  aria-label={`${doneCount} de ${totalCount} pasos completos`}
                >
                  <div
                    className="h-full rounded-full bg-primary-foreground transition-all duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* All-done CTA */}
              {allDone && (
                <Button
                  type="button"
                  onClick={() => navigate('/pos')}
                  className="mt-4 w-full sm:w-auto bg-primary-foreground text-primary hover:bg-primary-foreground/90 shadow-sm focus-visible:ring-primary-foreground"
                >
                  <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                  Abrir el punto de venta
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>

          {/* Resumability cue */}
          <div className="bg-primary/5 border-t border-primary/10 px-6 py-2.5 flex items-center gap-2 text-xs text-primary">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
            <span>Tu progreso se guarda automáticamente. Podés salir y volver cuando quieras.</span>
          </div>
        </Card>

        {/* ── Step list (nav overview) ──────────────────────────────────────── */}
        <nav aria-label="Pasos de configuración inicial">
          <ol className="space-y-2">
            {STEPS.map((s, idx) => {
              const done = isStepDone(s.key, idx);
              const isCurrent = idx === step;
              const Icon = s.icon;

              return (
                <li key={s.key}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleJumpTo(idx)}
                    disabled={saving}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Paso ${idx + 1}: ${s.title}${done ? ' (completo)' : isCurrent ? ' (actual)' : ''}`}
                    className={cn(
                      'h-auto w-full justify-start text-left font-normal rounded-xl border px-4 py-3 flex items-center gap-3 transition-all duration-150 group',
                      isCurrent
                        ? 'border-primary/30 bg-card shadow-md ring-2 ring-primary/10 hover:bg-card'
                        : done
                        ? 'border-beepbite-success/20 bg-beepbite-success/5 hover:bg-beepbite-success/10'
                        : 'border-border bg-card opacity-75 hover:opacity-100 hover:border-muted-foreground/30 hover:bg-card',
                      saving && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {/* Step number / check */}
                    <StepBadge index={idx} done={done} isCurrent={isCurrent} />

                    {/* Step icon + title */}
                    <span className={cn(
                      'flex items-center gap-2 flex-1 min-w-0 text-sm',
                      done ? 'text-beepbite-success' : isCurrent ? 'text-foreground font-semibold' : 'text-muted-foreground'
                    )}>
                      <Icon className={cn('w-4 h-4 shrink-0', done ? 'text-beepbite-success' : isCurrent ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                      <span className="truncate">{s.title}</span>
                    </span>

                    {/* Right-side indicator */}
                    {done && !isCurrent && (
                      <span className="text-xs text-beepbite-success font-medium shrink-0">Listo</span>
                    )}
                    {isCurrent && (
                      <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                        Actual
                      </span>
                    )}
                    {!done && !isCurrent && (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground transition-colors" aria-hidden="true" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Active step detail card ───────────────────────────────────────── */}
        {currentStepDef && (
          <Card className={cn(
            'border shadow-sm transition-all',
            stepDone ? 'border-beepbite-success/30' : 'border-primary/30'
          )}>
            <CardContent className="p-6 space-y-5">
              {/* Step header */}
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex items-center justify-center w-11 h-11 rounded-xl shrink-0',
                  stepDone ? 'bg-beepbite-success/10' : 'bg-primary/10'
                )}>
                  <StepIcon className={cn('w-5 h-5', stepDone ? 'text-beepbite-success' : 'text-primary')} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-foreground">
                      Paso {step + 1} — {currentStepDef.title}
                    </h2>
                    {stepDone && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-beepbite-success bg-beepbite-success/10 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Completo
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {currentStepDef.description}
                  </p>
                </div>
              </div>

              {/* Hint box — hidden for service style step (the picker replaces it) */}
              {!currentStepDef.isServiceStyleStep && (
                <div className="rounded-lg bg-primary/5 border border-primary/10 px-4 py-3">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Cómo completar este paso</p>
                  <p className="text-sm text-primary/90 leading-relaxed">{currentStepDef.hint}</p>
                </div>
              )}

              {/* Service style picker — shown inline for the service_style step */}
              {currentStepDef.isServiceStyleStep && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={serviceStyle === 'dine_in'}
                      onClick={() => void handlePickServiceStyle('dine_in')}
                      className={cn(
                        'h-auto justify-start font-normal flex items-start gap-3 rounded-xl border-2 p-4 text-left whitespace-normal focus-visible:ring-2 focus-visible:ring-primary/60',
                        serviceStyle === 'dine_in'
                          ? 'border-primary bg-primary/5 hover:bg-primary/5'
                          : 'border-border bg-card hover:border-primary/50 hover:bg-primary/5'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'dine_in' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <UtensilsCrossed className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Consumo en el local</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Tengo mesas y quiero usar el plano del salón y los asientos en el punto de venta.</p>
                      </div>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={serviceStyle === 'takeaway'}
                      onClick={() => void handlePickServiceStyle('takeaway')}
                      className={cn(
                        'h-auto justify-start font-normal flex items-start gap-3 rounded-xl border-2 p-4 text-left whitespace-normal focus-visible:ring-2 focus-visible:ring-primary/60',
                        serviceStyle === 'takeaway'
                          ? 'border-primary bg-primary/5 hover:bg-primary/5'
                          : 'border-border bg-card hover:border-primary/50 hover:bg-primary/5'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'takeaway' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <ShoppingBag className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Para llevar o mostrador</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">No necesito mesas. Los clientes piden en el mostrador y el punto de venta abre directamente el pedido.</p>
                      </div>
                    </Button>
                  </div>
                  {serviceStyleChosen && (
                    <p className="text-xs text-beepbite-success bg-beepbite-success/10 border border-beepbite-success/20 rounded-lg px-3 py-2 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Modalidad guardada. Podés cambiarla cuando quieras en Configuración → Local.
                    </p>
                  )}
                  {!serviceStyleChosen && (
                    <p className="text-xs text-muted-foreground">Elegí una opción para continuar. Podés cambiarla más adelante.</p>
                  )}
                </div>
              )}

              {/* Live status indicator */}
              {currentStepDef.statusKey && status && (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium border',
                    stepDone
                      ? 'bg-beepbite-success/10 text-beepbite-success border-beepbite-success/20'
                      : 'bg-beepbite-warning/10 text-beepbite-warning border-beepbite-warning/20'
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {stepDone ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-beepbite-success" aria-hidden="true" />
                  ) : (
                    <Circle className="w-4 h-4 shrink-0 text-beepbite-warning" aria-hidden="true" />
                  )}
                  <span className="flex-1">
                    {stepDone
                      ? 'Verificado: este paso está completo según los datos de tu cuenta.'
                      : 'Todavía falta completar este paso. Seguí las instrucciones y luego actualizá el estado.'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={refreshStatus}
                    disabled={statusLoading}
                    className="ml-auto h-auto gap-1 px-2 py-1 text-xs opacity-70 hover:opacity-100 hover:bg-transparent focus-visible:ring-1 focus-visible:ring-current"
                    aria-label="Volver a comprobar el estado"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', statusLoading && 'animate-spin')} aria-hidden="true" />
                    Actualizar
                  </Button>
                </div>
              )}

              {/* Empty / next-step encouragement when not done — hidden for the service style step
                  since its inline picker replaces the normal "go here and do X" pattern */}
              {!stepDone && !currentStepDef.isServiceStyleStep && (
                <div className="rounded-lg bg-muted border border-border px-4 py-3 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">¿Todavía no está listo?</span>{' '}
                    {currentStepDef.actionPath
                      ? 'Usá el botón de abajo, completá la tarea y volvé para marcarla como lista.'
                      : 'Completá el paso y luego seleccioná "Marcar como listo y continuar".'}
                  </p>
                </div>
              )}

              {/* Action row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {step > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBack}
                    disabled={saving}
                    className="gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    Atrás
                  </Button>
                )}

                {currentStepDef.actionPath && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleNavigate(currentStepDef.actionPath as string)}
                    className="gap-1 border-primary/30 text-primary hover:bg-primary/5"
                  >
                    {currentStepDef.actionLabel}
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                )}

                <div className="ml-auto">
                  {step < totalCount - 1 ? (
                    <Button
                      size="sm"
                      onClick={handleMarkDoneAndNext}
                      disabled={saving || (currentStepDef.isServiceStyleStep && !serviceStyleChosen)}
                      className="gap-1.5 font-semibold shadow-sm"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <>
                          {stepDone ? 'Continuar' : currentStepDef.isServiceStyleStep ? 'Confirmar y continuar' : 'Marcar como listo y continuar'}
                          <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => navigate('/pos')}
                      className="gap-1.5 font-semibold shadow-sm"
                    >
                      <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                      Abrir punto de venta
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Help footer ──────────────────────────────────────────────────── */}
        <footer className="text-center space-y-1 px-4">
          <p className="text-xs text-muted-foreground">
            ¿Necesitás ayuda?{' '}
            <a
              href="/docs/getting-started"
              className="inline-flex items-center gap-1 underline hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <BookOpen className="w-3 h-3" aria-hidden="true" />
              Leé la guía de inicio
            </a>
          </p>
          <p className="text-xs text-muted-foreground">
            Podés volver a este asistente cuando quieras desde el panel.
          </p>
        </footer>
      </div>
    </div>
  );
}
