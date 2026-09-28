import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Lock, AlertCircle, Utensils, CheckCircle2, ShieldCheck } from 'lucide-react';
import AuthLayout from './auth-layout';

interface FormData {
  email: string;
  password: string;
	confirmPassword: string;
  agreeToTerms: boolean;
}

interface FormErrors {
  email?: string;
  password?: string;
	confirmPassword?: string;
  agreeToTerms?: string;
  submit?: string;
}

const SignUpPage = () => {
  const navigate = useNavigate();
	const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { signUp } = useAuth();
	const invitedEmail = searchParams.get('email')?.trim().toLowerCase() || '';
	const invitationToken = searchParams.get('invite')?.trim() || '';
	const hasInvitation = Boolean(invitedEmail && invitationToken);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
		email: invitedEmail,
    password: '',
		confirmPassword: '',
    agreeToTerms: false,
  });

  // Live password requirement checks for visual feedback
  const pwChecks = {
    length: formData.password.length >= 12,
    upper: /[A-Z]/.test(formData.password),
    lower: /[a-z]/.test(formData.password),
    number: /\d/.test(formData.password),
  };
  const pwStarted = formData.password.length > 0;

  const validateForm = () => {
    const newErrors: FormErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Ingresá un correo electrónico válido';
    }
    const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{12,}$/;
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'La contraseña debe tener al menos 12 caracteres, mayúscula, minúscula y un número';
    }
		if (formData.confirmPassword !== formData.password) {
			newErrors.confirmPassword = 'Las contraseñas no coinciden';
		}
    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = 'Debés aceptar los términos y condiciones';
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
    if (validateForm()) {
      setIsLoading(true);
      try {
				await signUp(formData.email, formData.password, invitationToken || undefined);
        // signUp() calls the Go backend which issues tokens immediately.
        // Navigation is handled by auth context after SIGNED_IN event.
      } catch (error) {
        setErrors(prev => ({ ...prev, submit: error instanceof Error ? error.message : String(error) }));
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <AuthLayout>
      <Card variant="elevated" className="w-full">
        <CardHeader className="pb-2 pt-7 px-7 text-center space-y-1">
          <CardTitle className="text-2xl font-display font-semibold text-foreground">
            {t('auth.signUp.title')}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Solo para el propietario y personal invitado de RikoPollo
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7 pt-5 space-y-5">
          {/* Submit error */}
          <div aria-live="assertive" aria-atomic="true">
            {errors.submit && (
              <Alert variant="destructive" className="border-l-4 border-destructive bg-destructive/5">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
              </Alert>
            )}
          </div>

					{hasInvitation && (
						<div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
							<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
							<div>
								<p className="font-semibold">Invitación verificada</p>
								<p className="text-xs opacity-90">Creá tu contraseña para ingresar al equipo de RikoPollo.</p>
							</div>
						</div>
					)}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="signup-email" className="text-sm font-medium text-foreground">
                {t('auth.signUp.emailLabel')}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="tu@correo.com"
                  value={formData.email}
                  onChange={handleInputChange}
					disabled={isLoading || hasInvitation}
                  required
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'signup-email-error' : undefined}
                  className={`pl-10 h-11 rounded-xl text-base transition-colors ${errors.email ? 'border-destructive bg-destructive/5' : ''}`}
                />
              </div>
						{hasInvitation && <p className="text-xs text-muted-foreground">El correo está vinculado al enlace de invitación.</p>}
              <div aria-live="polite" aria-atomic="true">
                {errors.email && (
                  <p id="signup-email-error" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="signup-password" className="text-sm font-medium text-foreground">
                {t('auth.signUp.passwordLabel')}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <Input
                  id="signup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Creá una contraseña segura"
                  value={formData.password}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                  aria-invalid={!!errors.password}
                  aria-describedby="signup-password-reqs"
                  className={`pl-10 h-11 rounded-xl text-base transition-colors ${errors.password ? 'border-destructive bg-destructive/5' : ''}`}
                />
              </div>

              {/* Live password strength checklist */}
								<ul id="signup-password-reqs" className="space-y-0.5" aria-label="Requisitos de contraseña">
                {[
                  { key: 'length', label: 'Al menos 12 caracteres', met: pwChecks.length },
                  { key: 'upper', label: 'Una letra mayúscula', met: pwChecks.upper },
                  { key: 'lower', label: 'Una letra minúscula', met: pwChecks.lower },
                  { key: 'number', label: 'Un número', met: pwChecks.number },
                ].map(({ key, label, met }) => (
                  <li key={key} className={`text-xs flex items-center gap-1.5 transition-colors ${pwStarted ? (met ? 'text-success' : 'text-destructive') : 'text-muted-foreground'}`}>
                    <CheckCircle2 className={`w-3 h-3 shrink-0 transition-colors ${pwStarted && met ? 'text-success' : 'text-muted-foreground/50'}`} aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>

              <div aria-live="polite" aria-atomic="true">
                {errors.password && (
                  <p id="signup-password-error" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.password}
                  </p>
                )}
              </div>
            </div>

						<div className="space-y-1.5">
							<Label htmlFor="signup-password-confirm" className="text-sm font-medium text-foreground">
								Confirmar contraseña
							</Label>
							<div className="relative">
								<Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
								<Input
									id="signup-password-confirm"
									name="confirmPassword"
									type="password"
									autoComplete="new-password"
									placeholder="Repetí la contraseña"
									value={formData.confirmPassword}
									onChange={handleInputChange}
									disabled={isLoading}
									required
									aria-invalid={!!errors.confirmPassword}
									aria-describedby={errors.confirmPassword ? 'signup-password-confirm-error' : undefined}
									className={`pl-10 h-11 rounded-xl text-base ${errors.confirmPassword ? 'border-destructive bg-destructive/5' : ''}`}
								/>
							</div>
							{errors.confirmPassword && <p id="signup-password-confirm-error" className="text-xs text-destructive">{errors.confirmPassword}</p>}
						</div>

            {/* Terms checkbox */}
            <div className="space-y-1">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="signup-terms"
                  checked={formData.agreeToTerms}
                  onCheckedChange={(checked) => {
                    setFormData(prev => ({ ...prev, agreeToTerms: Boolean(checked) }));
                    if (errors.agreeToTerms) {
                      setErrors(prev => ({ ...prev, agreeToTerms: undefined }));
                    }
                  }}
                  disabled={isLoading}
                  aria-invalid={!!errors.agreeToTerms}
                  aria-describedby={errors.agreeToTerms ? 'signup-terms-error' : undefined}
                  className={`mt-0.5 ${errors.agreeToTerms ? 'border-destructive' : ''}`}
                />
                <Label htmlFor="signup-terms" className="text-sm text-foreground leading-relaxed cursor-pointer font-normal">
                  Acepto los{' '}
                  <a href="/docs/terms" className="text-primary hover:text-primary/80 font-medium underline underline-offset-1">Términos</a>
					{' '}y la{' '}
                  <a href="/docs/privacy" className="text-primary hover:text-primary/80 font-medium underline underline-offset-1">Política de privacidad</a>
                </Label>
              </div>
              <div aria-live="polite" aria-atomic="true">
                {errors.agreeToTerms && (
                  <p id="signup-terms-error" className="text-xs text-destructive flex items-center gap-1 ml-7">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.agreeToTerms}
                  </p>
                )}
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
                  Creando cuenta…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Utensils className="w-4 h-4" aria-hidden="true" />
                  Crear cuenta
                </span>
              )}
            </Button>
          </form>

          {/* Links */}
          <div className="text-center space-y-1.5">
            <p className="text-sm text-muted-foreground">
              {t('auth.signUp.hasAccount')}{' '}
              <button
                type="button"
                className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                onClick={() => navigate('/signin')}
                disabled={isLoading}
              >
                {t('auth.signUp.signInLink')}
              </button>
            </p>
            <p className="text-xs">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline underline-offset-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                onClick={() => navigate('/forgot-password')}
                disabled={isLoading}
              >
						¿Olvidaste tu contraseña?
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
};

export default SignUpPage;
