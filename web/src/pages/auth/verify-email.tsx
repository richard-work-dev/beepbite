import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api-client';
import AuthLayout from './auth-layout';

const VerifyEmailPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // confirmed = true when ?token= was validated successfully
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // If arriving with ?token= auto-submit the confirmation.
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setConfirming(true);
      api.request('POST', '/auth/verify/confirm', {
        auth: false,
        body: { token },
      }).then(({ error }) => {
        setConfirming(false);
        if (error) {
          const msg =
            error.status === 410
              ? 'Este enlace ya fue utilizado o venció. Usá el botón para solicitar otro.'
              : (error.message || 'No se pudo verificar el correo. Solicitá un nuevo enlace.');
          setErrorMessage(msg);
        } else {
          setConfirmed(true);
        }
      }).catch(() => {
        setConfirming(false);
        setErrorMessage('No se pudo verificar el correo. Intentá nuevamente.');
      });
    } else {
      const pendingEmail = localStorage.getItem('pendingVerificationEmail');
      if (pendingEmail) {
        setEmail(pendingEmail);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResendEmail = async () => {
    setIsResending(true);
    setSuccessMessage('');
    setErrorMessage('');
    try {
      const body = email ? { email } : {};
      await api.request('POST', '/auth/verify/send', {
        auth: false,
        body,
      });
      setSuccessMessage('Correo de verificación enviado. Revisá tu bandeja de entrada.');
      setResendCooldown(60);
    } catch (error) {
      console.error('Failed to resend verification email:', error);
      setErrorMessage('No se pudo reenviar. Intentá nuevamente.');
    } finally {
      setIsResending(false);
    }
  };

  const handleChangeEmail = () => {
    localStorage.removeItem('pendingVerificationEmail');
    localStorage.removeItem('pendingUserData');
    void navigate('/signup');
  };

  return (
    <AuthLayout>
      <Card variant="elevated" className="w-full">
        {confirmed ? (
          /* ── Confirmed success state ── */
          <>
            <CardHeader className="pb-2 pt-7 px-7 text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-success/15 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-success" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-display font-semibold text-foreground">
                  ¡Correo verificado!
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Tu correo fue confirmado. Ya podés ingresar.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-7 pb-7 pt-2">
              <Button
                className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow transition-all text-sm"
                onClick={() => navigate('/signin')}
              >
                Ingresar al sistema
              </Button>
            </CardContent>
          </>
        ) : confirming ? (
          /* ── Auto-confirming spinner ── */
          <CardContent className="px-7 py-12 flex flex-col items-center gap-4">
            <span className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Verificando tu correo…</p>
          </CardContent>
        ) : (
          /* ── Default: check-your-inbox / resend state ── */
          <>
            <CardHeader className="pb-2 pt-7 px-7 text-center space-y-4">
              {/* Mail icon */}
              <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Mail className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-display font-semibold text-foreground">
                  Revisá tu correo
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Enviamos un enlace de verificación a{' '}
                  <strong className="text-foreground font-semibold">{email || 'tu correo electrónico'}</strong>
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="px-7 pb-7 pt-2 space-y-4">
              {/* Feedback — aria-live regions */}
              <div aria-live="polite" aria-atomic="true">
                {successMessage && (
                  <Alert className="border-l-4 border-success bg-success/10">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" aria-hidden="true" />
                    <AlertDescription className="text-sm text-success">
                      {successMessage}
                    </AlertDescription>
                  </Alert>
                )}
                {errorMessage && (
                  <Alert variant="destructive" className="border-l-4 border-destructive bg-destructive/5">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Instructional info box */}
              <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3.5 space-y-2">
                <p className="text-sm font-medium text-foreground">Próximos pasos</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Abrí el correo de RikoPollo</li>
                  <li>Presioná el enlace <strong className="font-medium text-foreground">Verificar correo</strong></li>
                  <li>Volverás automáticamente al sistema</li>
                </ol>
                <p className="text-xs text-muted-foreground pt-0.5">
                  ¿No lo encontrás? Revisá la carpeta de correo no deseado.
                </p>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <Button
                  onClick={handleResendEmail}
                  disabled={isResending || resendCooldown > 0}
                  className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground font-semibold shadow-glow hover:shadow-glow transition-all text-sm"
                  aria-label={resendCooldown > 0 ? `Reenvío disponible en ${resendCooldown} segundos` : 'Reenviar correo de verificación'}
                >
                  {isResending ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                      Enviando…
                    </span>
                  ) : resendCooldown > 0 ? (
                    `Reenviar en ${resendCooldown}s`
                  ) : (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" aria-hidden="true" />
                      Reenviar correo de verificación
                    </span>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleChangeEmail}
                  className="w-full h-11 rounded-xl border-border hover:bg-muted font-medium text-sm"
                >
                  Usar otro correo
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => navigate('/signin')}
                  className="w-full h-11 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted font-medium text-sm"
                >
                  Volver al ingreso
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Después de verificar el correo ingresarás al sistema de RikoPollo.
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </AuthLayout>
  );
};

export default VerifyEmailPage;
