import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { AlertCircle, Download, Loader2, LockKeyhole, Trash2, UserCog } from 'lucide-react';
import { useDateTime } from '@/context/locale-context';
import { useAuth } from '@/context/auth-context';
import { requestDataExport, requestOrganizationPurge } from '@/services/datarights';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// AccountSettings — Wave 31 data-rights page
//
// Tenant deletion is owner-only, explicitly confirmed, and runs asynchronously.
// ---------------------------------------------------------------------------

const AccountSettings = () => {
  const { today } = useDateTime();
  const { activeOrganization, activeMembership } = useAuth();

  const [exportState, setExportState]   = useState<string>('idle');   // idle | loading | done | error
  const [exportError, setExportError]   = useState('');
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordState, setPasswordState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [purgeState, setPurgeState] = useState<'idle' | 'loading' | 'pending' | 'error'>('idle');
  const [purgeMessage, setPurgeMessage] = useState('');

  const isOwner = activeMembership?.role === 'owner';
  const organizationName = activeOrganization?.name?.trim() || '';
  const purgeNameMatches = purgeConfirmation.trim().toLocaleLowerCase() === organizationName.toLocaleLowerCase();

  // ── Export data ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExportState('loading');
    setExportError('');
    const { data, error } = await requestDataExport();
    if (error) {
      setExportError(error.message ?? 'No se pudo exportar. Intentá nuevamente.');
      setExportState('error');
      return;
    }
    // Trigger browser download of the archive JSON.
    const blob = new Blob([JSON.stringify(data?.archive ?? data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    // The store's local trading date, not `new Date().toISOString().slice(0, 10)`
    // (the UTC date — wrong for most of the day in most timezones).
    a.download = `beepbite-export-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportState('done');
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage('');
    if (password.next !== password.confirm) {
      setPasswordState('error');
      setPasswordMessage('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{12,}$/.test(password.next)) {
      setPasswordState('error');
      setPasswordMessage('Usá al menos 12 caracteres, una mayúscula, una minúscula y un número.');
      return;
    }
    setPasswordState('loading');
    try {
      const { error } = await api.auth.updateUser({ password: password.next, current_password: password.current });
      if (error) {
        setPasswordState('error');
        setPasswordMessage(error.message || 'No se pudo actualizar la contraseña.');
        return;
      }
      setPassword({ current: '', next: '', confirm: '' });
      setPasswordState('done');
      setPasswordMessage('Contraseña actualizada. Volvé a iniciar sesión en los demás dispositivos.');
    } catch {
      setPasswordState('error');
      setPasswordMessage('No se pudo conectar. Revisá tu conexión e intentá nuevamente.');
    }
  };

  const handlePurgeRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOwner || !organizationName || !purgeNameMatches) return;
    setPurgeState('loading');
    setPurgeMessage('');
    const { data, error } = await requestOrganizationPurge(purgeConfirmation);
    if (error) {
      setPurgeState('error');
      setPurgeMessage(error.message || 'No se pudo iniciar la purga. Intentá nuevamente.');
      return;
    }
    setPurgeState('pending');
    setPurgeMessage(data?.message || 'La purga fue solicitada. El acceso quedó bloqueado y el proceso continúa en segundo plano.');
  };

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        eyebrow="Configuración"
        title="Cuenta y datos"
        description="Exportá los datos de tu organización y revisá las opciones de privacidad disponibles."
        icon={UserCog}
      />

      {/* ── Export data ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5" /> Cambiar contraseña</CardTitle>
          <CardDescription>Confirmá tu contraseña actual. Al cambiarla, se cerrarán las sesiones de renovación de los demás dispositivos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handlePasswordChange}>
            <label className="block space-y-1.5 text-sm font-medium">Contraseña actual
              <input className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal" type="password" autoComplete="current-password" required value={password.current} onChange={event => setPassword({ ...password, current: event.target.value })} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">Nueva contraseña
              <input className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal" type="password" autoComplete="new-password" required value={password.next} onChange={event => setPassword({ ...password, next: event.target.value })} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">Repetir nueva contraseña
              <input className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal" type="password" autoComplete="new-password" required value={password.confirm} onChange={event => setPassword({ ...password, confirm: event.target.value })} />
            </label>
            {passwordMessage && <p role={passwordState === 'error' ? 'alert' : 'status'} className={`text-sm ${passwordState === 'error' ? 'text-destructive' : 'text-success'}`}>{passwordMessage}</p>}
            <Button type="submit" disabled={passwordState === 'loading'}>{passwordState === 'loading' ? 'Actualizando…' : 'Actualizar contraseña'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exportar tus datos</CardTitle>
          <CardDescription>
            Descargá un archivo JSON con los registros disponibles de tu organización.
            El archivo se descarga en el momento; si supera 4 MB, el API informa que
            hace falta una exportación preparada en segundo plano.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportError && (
            <p className="text-destructive text-sm">{exportError}</p>
          )}
          {exportState === 'done' && (
            <p className="text-success text-sm font-medium">
              Exportación descargada correctamente.
            </p>
          )}
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportState === 'loading'}
          >
            {exportState === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {exportState === 'loading' ? 'Preparando archivo…' : 'Exportar datos'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Eliminación completa de la cuenta
          </CardTitle>
          <CardDescription>
            Esta acción inicia una purga irreversible de la organización, sus registros y archivos cargados.
            El acceso se bloquea al solicitarla. Descargá una copia antes de continuar; no se puede cancelar.
            Las copias de seguridad administradas por AWS conservan su retención configurada y los archivos
            antiguos sin una ruta de organización verificable no se eliminan automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {purgeState === 'pending' ? (
            <p role="status" className="text-sm font-medium text-destructive">{purgeMessage}</p>
          ) : isOwner ? (
            <form className="space-y-3" onSubmit={handlePurgeRequest}>
              <label className="block space-y-1.5 text-sm font-medium" htmlFor="purge-organization-name">
                Escribí el nombre de la organización para confirmar: <span className="font-bold">{organizationName || 'sin organización activa'}</span>
                <input
                  id="purge-organization-name"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal"
                  autoComplete="off"
                  value={purgeConfirmation}
                  onChange={(event) => setPurgeConfirmation(event.target.value)}
                  disabled={purgeState === 'loading' || !organizationName}
                />
              </label>
              {purgeMessage && <p role="alert" className="text-sm text-destructive">{purgeMessage}</p>}
              <Button type="submit" variant="destructive" disabled={!purgeNameMatches || purgeState === 'loading' || !organizationName}>
                {purgeState === 'loading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertCircle className="mr-2 h-4 w-4" />}
                Iniciar purga irreversible
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Solo el propietario de la organización puede solicitar la purga.</p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
};

export default AccountSettings;
