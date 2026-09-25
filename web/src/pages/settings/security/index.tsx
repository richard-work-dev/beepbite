/**
 * Security Settings page — Wave 39 TOTP two-factor authentication.
 *
 * Three states:
 *   1. Not enrolled  → Show "Set up 2FA" button → enroll flow (QR code).
 *   2. Enrolled      → Show verify-code form → returns backup codes.
 *   3. Enabled       → Show status + "Disable 2FA" form.
 *
 * Route: wired externally; this file is the default export.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  KeyRound,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { FormEvent } from 'react';
import {
  getTOTPStatus,
  enrollTOTP,
  verifyTOTP,
  disableTOTP,
} from '@/services/twofa';

// ── Step enum ─────────────────────────────────────────────────────────────────

const STEP = {
  LOADING: 'loading',
  DISABLED: 'disabled',      // 2FA off, not enrolled
  ENROLLING: 'enrolling',    // otpauth URL shown, waiting for verification
  VERIFYING: 'verifying',    // submitting code
  BACKUP_SHOWN: 'backup',    // newly generated backup codes visible
  ENABLED: 'enabled',        // 2FA on
  DISABLING: 'disabling',    // form to disable
} as const;

type Step = typeof STEP[keyof typeof STEP];

// ── Backup code copy helper ──────────────────────────────────────────────────

function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    // Only show the "Copied!" confirmation once the write actually
    // succeeds — previously setCopied(true) ran unconditionally, so a
    // failed clipboard write (e.g. permission denied) still told the user
    // their 2FA backup codes were copied when they weren't.
    navigator.clipboard.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err: unknown) => {
      console.error('Failed to copy backup codes:', err);
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <div
            key={c}
            className="bg-muted rounded px-3 py-1.5 tracking-widest text-center select-all"
          >
            {c}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copiados' : 'Copiar todos'}
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SecuritySettings() {
  const [step, setStep] = useState<Step>(STEP.LOADING);
  const [otpauthURL, setOtpauthURL] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupRemaining, setBackupRemaining] = useState(0);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableBackup, setDisableBackup] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clearError = () => setError('');

  // Load current status on mount.
  const loadStatus = useCallback(async () => {
    setStep(STEP.LOADING);
    // getTOTPStatus() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) propagates as a
    // rejected promise. Without this try/catch, that left the security
    // settings page stuck on STEP.LOADING forever with the rejection
    // silently swallowed.
    try {
      const { data: result, error: err } = await getTOTPStatus();
      if (err) {
        setError(err.message || 'No se pudo cargar el estado de la autenticación en dos pasos');
        setStep(STEP.DISABLED);
        return;
      }
      const data = result!;
      if (data.enabled) {
        setBackupRemaining(data.backup_codes_remaining);
        setStep(STEP.ENABLED);
      } else if (data.enrolled) {
        // Has a pending secret but hasn't verified yet — show enroll flow again.
        setStep(STEP.DISABLED);
      } else {
        setStep(STEP.DISABLED);
      }
    } catch (err) {
      console.error('Error loading 2FA status:', err);
      setError('No se pudo cargar el estado de la autenticación en dos pasos');
      setStep(STEP.DISABLED);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // ── Enroll: generate TOTP secret + QR code ────────────────────────────────

  const handleEnroll = async () => {
    clearError();
    setBusy(true);
    const { data, error: err } = await enrollTOTP();
    setBusy(false);
    if (err) {
      setError(err.message || 'No se pudo iniciar la configuración');
      return;
    }
    setOtpauthURL(data!.otpauth_url);
    setVerifyCode('');
    setStep(STEP.ENROLLING);
  };

  // ── Verify: validate code + get backup codes ──────────────────────────────

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearError();
    if (!verifyCode.trim()) {
      setError('Ingresá el código de 6 dígitos de tu aplicación de autenticación');
      return;
    }
    setBusy(true);
    const { data, error: err } = await verifyTOTP(verifyCode.trim());
    setBusy(false);
    if (err) {
      setError(err.message || 'Código inválido. Intentá nuevamente.');
      return;
    }
    setBackupCodes(data!.backup_codes);
    setStep(STEP.BACKUP_SHOWN);
  };

  // ── Disable 2FA ───────────────────────────────────────────────────────────

  const handleDisable = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearError();
    if (!disableCode.trim() && !disableBackup.trim()) {
      setError('Ingresá tu código de autenticación o un código de respaldo para desactivar la verificación en dos pasos');
      return;
    }
    setBusy(true);
    const { error: err } = await disableTOTP({
      code: disableCode.trim() || undefined,
      backup_code: disableBackup.trim() || undefined,
    });
    setBusy(false);
    if (err) {
      setError(err.message || 'No se pudo desactivar la verificación en dos pasos');
      return;
    }
    setDisableCode('');
    setDisableBackup('');
    void loadStatus();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer className="max-w-2xl">
      {/* Page header */}
      <PageHeader
        eyebrow="Configuración"
        title="Seguridad"
        description="Administrá la seguridad de tu cuenta."
        icon={Shield}
      />

      {/* Error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Two-factor authentication card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {step === STEP.ENABLED ? (
              <ShieldCheck className="h-5 w-5 text-success" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            Autenticación en dos pasos
            {step === STEP.ENABLED && (
              <Badge variant="success" className="ml-1">
                Activada
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Usá una aplicación como Google Authenticator o Authy para generar
            códigos temporales y agregar una capa adicional de seguridad.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* ── LOADING ── */}
          {step === STEP.LOADING && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando…
            </div>
          )}

          {/* ── DISABLED: prompt to set up ── */}
          {step === STEP.DISABLED && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                La autenticación en dos pasos no está activada en tu cuenta.
              </p>
              <Button onClick={handleEnroll} disabled={busy} className="gap-1.5">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Configurar verificación en dos pasos
              </Button>
            </div>
          )}

          {/* ── ENROLLING: show QR code ── */}
          {step === STEP.ENROLLING && (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  1. Escaneá este código QR con tu aplicación de autenticación
                </p>
                <div className="inline-block p-3 bg-card rounded-lg border shadow-sm">
                  <QRCodeSVG value={otpauthURL} size={180} />
                </div>
                <p className="text-xs text-muted-foreground">
                  ¿No podés escanearlo? Copiá la URL manualmente:
                </p>
                <code className="block text-xs break-all bg-muted px-2 py-1.5 rounded select-all">
                  {otpauthURL}
                </code>
              </div>

              <Separator />

              <form onSubmit={handleVerify} className="space-y-3">
                <p className="text-sm font-medium">
                  2. Ingresá el código de 6 dígitos de la aplicación
                </p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                    className="w-36 font-mono text-lg tracking-widest"
                    autoComplete="one-time-code"
                    required
                  />
                  <Button type="submit" disabled={busy || verifyCode.length !== 6}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verificar'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => { setStep(STEP.DISABLED); clearError(); }}
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* ── BACKUP CODES: show once ── */}
          {step === STEP.BACKUP_SHOWN && (
            <div className="space-y-4">
              <Alert className="border-success/20 bg-success/10">
                <ShieldCheck className="h-4 w-4 text-success" />
                <AlertDescription className="text-success">
                  La autenticación en dos pasos está activada. Guardá estos códigos
                  de respaldo en un lugar seguro; no se volverán a mostrar.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <p className="text-sm font-medium">Códigos de respaldo</p>
                <p className="text-xs text-muted-foreground">
                  Cada código puede usarse una sola vez si perdés el acceso a tu
                  aplicación de autenticación.
                </p>
                <BackupCodes codes={backupCodes} />
              </div>

              <Button onClick={() => { setBackupCodes([]); void loadStatus(); }}>
                Guardé mis códigos de respaldo
              </Button>
            </div>
          )}

          {/* ── ENABLED: status + disable form ── */}
          {step === STEP.ENABLED && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  La autenticación en dos pasos está activa.{' '}
                  <span className="font-medium text-foreground">
                    Quedan {backupRemaining} {backupRemaining === 1 ? 'código' : 'códigos'} de respaldo.
                  </span>
                </p>
              </div>

              {step === STEP.ENABLED && (
                <Button
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5"
                  onClick={() => { setStep(STEP.DISABLING); clearError(); }}
                >
                  <ShieldOff className="h-4 w-4" />
                  Desactivar verificación en dos pasos
                </Button>
              )}
            </div>
          )}

          {/* ── DISABLING: confirmation form ── */}
          {step === STEP.DISABLING && (
            <form onSubmit={handleDisable} className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Desactivar esta función reduce la seguridad de tu cuenta. Ingresá
                  el código de autenticación o uno de respaldo para confirmar.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="disable-code">Código de autenticación</Label>
                  <Input
                    id="disable-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={disableCode}
                    onChange={(e) => {
                      setDisableCode(e.target.value.replace(/\D/g, ''));
                      setDisableBackup('');
                    }}
                    className="w-36 font-mono"
                    autoComplete="one-time-code"
                  />
                </div>

                <p className="text-xs text-muted-foreground">— o —</p>

                <div className="space-y-1.5">
                  <Label htmlFor="disable-backup">Código de respaldo</Label>
                  <Input
                    id="disable-backup"
                    type="text"
                    placeholder="XXXX-XXXX"
                    value={disableBackup}
                    onChange={(e) => {
                      setDisableBackup(e.target.value.toUpperCase());
                      setDisableCode('');
                    }}
                    className="w-40 font-mono"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={busy || (!disableCode && !disableBackup)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Desactivar verificación en dos pasos
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setStep(STEP.ENABLED); clearError(); }}
                  disabled={busy}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
