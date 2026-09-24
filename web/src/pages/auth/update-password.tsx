import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, AlertCircle, Eye, EyeOff, CheckCircle2, Utensils } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api-client';
import AuthLayout from './auth-layout';

interface FormData {
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  password?: string;
  confirmPassword?: string;
  submit?: string;
}

const UpdatePasswordPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState<FormData>({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdated, setIsUpdated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Live requirement checks
  const pwChecks = {
    length: formData.password.length >= 8,
    upper: /[A-Z]/.test(formData.password),
    number: /\d/.test(formData.password),
  };
  const pwStarted = formData.password.length > 0;
  const confirmStarted = formData.confirmPassword.length > 0;
  const passwordsMatch = formData.password === formData.confirmPassword;

  const validateForm = () => {
    const newErrors: FormErrors = {};
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const token = searchParams.get('token');
      if (!token) {
        setErrors(prev => ({ ...prev, submit: 'El enlace no existe o no es válido. Solicitá uno nuevo.' }));
        return;
      }
      const { error } = await api.request('POST', '/auth/password/reset', {
        auth: false,
        body: { token, new_password: formData.password },
      });
      if (error) {
        const msg =
          error.status === 410
            ? 'Este enlace ya fue utilizado o venció. Solicitá uno nuevo.'
            : (error.message || 'No se pudo actualizar la contraseña. Intentá nuevamente.');
        setErrors(prev => ({ ...prev, submit: msg }));
        return;
      }
      setIsUpdated(true);
    } catch (_err) {
      setErrors(prev => ({ ...prev, submit: 'No se pudo actualizar la contraseña. Intentá nuevamente.' }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Card variant="elevated" className="w-full">
        <CardHeader className="pb-2 pt-7 px-7 text-center space-y-1">
          <CardTitle className="text-2xl font-display font-semibold text-foreground">
            Actualizar contraseña
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Elegí una contraseña segura para tu cuenta
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7 pt-4">
          {!isUpdated ? (
            <div className="space-y-5">
              {/* Submit error */}
              <div aria-live="assertive" aria-atomic="true">
                {errors.submit && (
                  <Alert variant="destructive" className="border-l-4 border-destructive bg-destructive/5">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
                  </Alert>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {/* New password */}
                <div className="space-y-1.5">
                  <Label htmlFor="update-password" className="text-sm font-medium text-foreground">
                    Nueva contraseña
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                    <Input
                      id="update-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Ingresá la nueva contraseña"
                      value={formData.password}
                      onChange={handleInputChange}
                      disabled={isLoading}
                      aria-invalid={!!errors.password}
                      aria-describedby="update-password-reqs"
                      className={`pl-10 pr-10 h-11 rounded-xl text-base transition-colors ${errors.password ? 'border-destructive bg-destructive/5' : ''}`}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>

                  {/* Live requirement checklist */}
                  <ul id="update-password-reqs" className="space-y-0.5" aria-label="Requisitos de contraseña">
                    {[
                      { label: 'Al menos 8 caracteres', met: pwChecks.length },
                      { label: 'Una letra mayúscula', met: pwChecks.upper },
                      { label: 'Un número', met: pwChecks.number },
                    ].map(({ label, met }) => (
                      <li key={label} className={`text-xs flex items-center gap-1.5 transition-colors ${pwStarted ? (met ? 'text-success' : 'text-destructive') : 'text-muted-foreground'}`}>
                        <CheckCircle2 className={`w-3 h-3 shrink-0 ${pwStarted && met ? 'text-success' : 'text-muted-foreground/50'}`} aria-hidden="true" />
                        {label}
                      </li>
                    ))}
                  </ul>

                  <div aria-live="polite" aria-atomic="true">
                    {errors.password && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        {errors.password}
                      </p>
                    )}
                  </div>
                </div>

                {/* Confirm password */}
                <div className="space-y-1.5">
                  <Label htmlFor="update-confirm-password" className="text-sm font-medium text-foreground">
                    Confirmar nueva contraseña
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                    <Input
                      id="update-confirm-password"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Repetí la nueva contraseña"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      disabled={isLoading}
                      aria-invalid={!!errors.confirmPassword}
                      aria-describedby={errors.confirmPassword ? 'update-confirm-error' : undefined}
                      className={`pl-10 pr-10 h-11 rounded-xl text-base transition-colors ${errors.confirmPassword ? 'border-destructive bg-destructive/5' : (confirmStarted && passwordsMatch ? 'border-success/60' : '')}`}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded transition-colors"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      aria-label={showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                  <div aria-live="polite" aria-atomic="true">
                    {errors.confirmPassword ? (
                      <p id="update-confirm-error" className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        {errors.confirmPassword}
                      </p>
                    ) : confirmStarted && passwordsMatch ? (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                        Las contraseñas coinciden
                      </p>
                    ) : null}
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground font-semibold shadow-glow hover:shadow-glow transition-all text-sm"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" aria-hidden="true" />
                      Actualizando contraseña…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Lock className="w-4 h-4" aria-hidden="true" />
                      Actualizar contraseña
                    </span>
                  )}
                </Button>
              </form>
            </div>
          ) : (
            /* Success state */
            <div className="space-y-6" role="status" aria-live="polite">
              <div className="flex flex-col items-center gap-4 py-3">
                <div className="w-16 h-16 rounded-2xl bg-success/15 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-success" aria-hidden="true" />
                </div>
                <div className="text-center space-y-1.5">
                  <h2 className="font-display font-semibold text-foreground text-lg">¡Contraseña actualizada!</h2>
                  <p className="text-sm text-muted-foreground">
                    Tu contraseña fue cambiada. Ya podés ingresar con tus nuevas credenciales.
                  </p>
                </div>
              </div>

              <Button
                className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow transition-all text-sm"
                onClick={() => navigate('/signin')}
              >
                <span className="flex items-center gap-2">
                  <Utensils className="w-4 h-4" aria-hidden="true" />
                  Ingresar al sistema
                </span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
};

export default UpdatePasswordPage;
