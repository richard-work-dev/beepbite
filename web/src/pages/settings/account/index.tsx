import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { AlertCircle, Download, Trash2, RotateCcw, Loader2, UserCog } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDateTime } from '@/context/locale-context';
import { deleteAccount, restoreAccount, requestDataExport } from '@/services/datarights';

// ---------------------------------------------------------------------------
// AccountSettings — Wave 31 data-rights page
//
// Capabilities surfaced:
//   • Delete account  — soft-delete with 30-day grace / cancel window
//   • Restore account — cancel a pending soft-delete
//   • Export data     — download a full JSON archive
// ---------------------------------------------------------------------------

const AccountSettings = () => {
  const { activeOrganization } = useAuth();
  const { today } = useDateTime();
  const isDeleted = Boolean(activeOrganization?.deleted_at);

  const [deleteState, setDeleteState]   = useState<string>('idle');   // idle | confirm | loading | done
  const [restoreState, setRestoreState] = useState<string>('idle');   // idle | loading | done
  const [exportState, setExportState]   = useState<string>('idle');   // idle | loading | done | error
  const [exportError, setExportError]   = useState('');
  const [deleteError, setDeleteError]   = useState('');
  const [restoreError, setRestoreError] = useState('');

  // ── Delete account ─────────────────────────────────────────────────────────
  const handleDeleteRequest = () => setDeleteState('confirm');
  const handleDeleteCancel  = () => setDeleteState('idle');

  const handleDeleteConfirm = async () => {
    setDeleteState('loading');
    setDeleteError('');
    const { error } = await deleteAccount();
    if (error) {
      setDeleteError(error.message ?? 'Ocurrió un error. Intentá nuevamente.');
      setDeleteState('confirm');
      return;
    }
    setDeleteState('done');
  };

  // ── Restore account ────────────────────────────────────────────────────────
  const handleRestore = async () => {
    setRestoreState('loading');
    setRestoreError('');
    const { error } = await restoreAccount();
    if (error) {
      setRestoreError(error.message ?? 'Ocurrió un error. Intentá nuevamente.');
      setRestoreState('idle');
      return;
    }
    setRestoreState('done');
  };

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

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        eyebrow="Configuración"
        title="Cuenta y datos"
        description="Administrá tu cuenta, exportá tus datos o solicitá su eliminación."
        icon={UserCog}
      />

      {/* ── Restore notice (shown when org is soft-deleted) ── */}
      {(isDeleted || restoreState === 'done' || deleteState === 'done') && (
        <Card className="border-warning/40 bg-warning/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertCircle className="h-5 w-5" />
              Cuenta programada para eliminarse
            </CardTitle>
            <CardDescription className="text-warning">
              Tu cuenta se eliminará definitivamente cuando termine el período de gracia
              de 30 días. Podés cancelar la eliminación a continuación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {restoreState === 'done' ? (
              <p className="text-success font-medium">
                Eliminación cancelada: tu cuenta está activa nuevamente.
              </p>
            ) : (
              <>
                {restoreError && (
                  <p className="text-destructive text-sm mb-3">{restoreError}</p>
                )}
                <Button
                  variant="outline"
                  className="border-warning/60 text-warning hover:bg-warning/10"
                  onClick={handleRestore}
                  disabled={restoreState === 'loading'}
                >
                  {restoreState === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Cancelar eliminación y restaurar cuenta
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Export data ── */}
      <Card>
        <CardHeader>
          <CardTitle>Exportar tus datos</CardTitle>
          <CardDescription>
            Descargá un archivo JSON con los pedidos, clientes, personal y registro
            de auditoría de tu organización de los últimos 90 días.
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

      {/* ── Delete account ── */}
      {!isDeleted && deleteState !== 'done' && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Eliminar cuenta</CardTitle>
            <CardDescription>
              Elimina definitivamente tu organización y todos sus datos luego de un
              período de gracia de 30 días. Podés revertir la acción durante ese plazo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deleteError && (
              <p className="text-destructive text-sm">{deleteError}</p>
            )}

            {deleteState !== 'confirm' ? (
              <Button
                variant="destructive"
                onClick={handleDeleteRequest}
                disabled={deleteState === 'loading'}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar cuenta
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-destructive font-medium">
                  ¿Confirmás la eliminación? Tu cuenta quedará programada para eliminarse
                  definitivamente dentro de 30 días.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    onClick={handleDeleteConfirm}
                    disabled={(deleteState as string) === 'loading'}
                  >
                    {(deleteState as string) === 'loading' ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Sí, eliminar mi cuenta
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDeleteCancel}
                    disabled={(deleteState as string) === 'loading'}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
};

export default AccountSettings;
