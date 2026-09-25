import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import {
  Building2,
  MapPin,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Edit,
  FileText,
  ChevronRight,
} from 'lucide-react';
import BusinessInfoPage from './business-info';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

// Mirrors backend/migrations/001_baseline.sql `locations` table (subset used
// by this page). supabase.from(...) goes through the untyped api.from(...)
// query builder (the one documented `any` in the codebase), so this
// interface is applied locally to keep this page's own state honestly typed.
interface OrgLocation {
  id: string;
  name: string;
  address?: string | null;
  is_active: boolean;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  whatsapp_number?: string | null;
}

interface OrgFormData {
  name: string;
  is_active: boolean;
}

const OrganizationSettings = () => {
  const { activeOrganization, fetchOrganizations } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('organization');
  const [locations, setLocations] = useState<OrgLocation[]>([]);
  const [formData, setFormData] = useState<OrgFormData>({
    // Organization data
    name: '',
    is_active: true
  });

  useEffect(() => {
    if (activeOrganization) {
      // loadOrganizationData() is fully try/catch/finally-wrapped below.
      void loadOrganizationData();
    }
  }, [activeOrganization]);

  const loadOrganizationData = async () => {
    if (!activeOrganization) return;

    setLoading(true);
    try {
      // Load organization data
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', activeOrganization.id)
        .single();

      if (orgError) {
        console.error('Error loading organization data:', orgError);
      }

      // Load locations for this organization
      const { data: locationsData, error: locationsError } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', activeOrganization.id)
        .order('name');

      if (locationsError) {
        console.error('Error loading locations:', locationsError);
      }

      setFormData({
        name: orgData?.name || '',
        is_active: orgData?.is_active ?? true
      });

      setLocations(locationsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = <K extends keyof OrgFormData>(field: K, value: OrgFormData[K]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const saveOrganizationSettings = async () => {
    if (!activeOrganization) return;

    setSaving(true);
    setSaveMessage('');

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        throw new Error('Organization name is required');
      }

      // Update organization
      const { error: orgError } = await supabase
        .from('organizations')
        .update({
          name: formData.name.trim(),
          is_active: formData.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeOrganization.id);

      if (orgError) throw orgError;

      setSaveMessage('Organization settings saved successfully!');

      // Refresh organizations in auth context
      await fetchOrganizations();

      // Reload data to reflect changes
      void loadOrganizationData();

      setTimeout(() => {
        setSaveMessage('');
      }, 3000);

    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage(error instanceof Error ? error.message : 'Failed to save settings. Please try again.');

      setTimeout(() => {
        setSaveMessage('');
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-[72px] w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </PageContainer>
    );
  }

  const isSuccess = saveMessage.includes('successfully');

  return (
    <PageContainer>
      {/* Page header */}
      <Reveal>
        <PageHeader
          eyebrow="Configuración"
          title="Organización"
          description="Administrá el perfil de tu organización y sus locales."
          icon={Building2}
          actions={
            <Button
              onClick={saveOrganizationSettings}
              disabled={saving || activeTab !== 'organization'}
              className={cn(
                'hidden sm:inline-flex shadow-sm transition-all duration-200',
                activeTab !== 'organization' && 'opacity-0 pointer-events-none'
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Guardar cambios
                </>
              )}
            </Button>
          }
        />
      </Reveal>

      {/* Save message */}
      {saveMessage && (
        <Reveal delay={0.05}>
          <div
            className={cn(
              'flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium',
              isSuccess
                ? 'bg-success/10 text-success border-success/20'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            )}
          >
            {isSuccess ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{saveMessage}</span>
          </div>
        </Reveal>
      )}

      {/* Active org banner */}
      <Reveal delay={0.07}>
        <Card variant="feature" className="border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Building2 className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">{activeOrganization?.name || 'Organización desconocida'}</p>
                <p className="text-xs text-muted-foreground">Organización activa</p>
              </div>
              <Badge variant={formData.is_active ? 'default' : 'secondary'} className="shrink-0">
                {formData.is_active ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {/* Settings tabs */}
      <Reveal delay={0.1}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted/60 rounded-xl">
            <TabsTrigger
              value="organization"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden xs:inline">Organización</span>
              <span className="xs:hidden">Org.</span>
            </TabsTrigger>
            <TabsTrigger
              value="locations"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <MapPin className="w-4 h-4" />
              <span>Locales</span>
            </TabsTrigger>
            <TabsTrigger
              value="businessinfo"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden xs:inline">Datos comerciales</span>
              <span className="xs:hidden">Info</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Organization tab ── */}
          <TabsContent value="organization" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Información de la organización</CardTitle>
                      <CardDescription className="mt-0.5">Nombre y estado operativo de tu organización.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Name field */}
                  <div className="space-y-1.5">
                    <label htmlFor="org-name" className="block text-sm font-medium text-foreground">
                      Nombre de la organización <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="org-name"
                      placeholder="Nombre de tu organización"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      className="rounded-xl h-10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      La organización agrupa todos tus locales
                    </p>
                  </div>

                  {/* Status toggle */}
                  <div className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-xl border border-border/50">
                    <div>
                      <p className="text-sm font-medium text-foreground">Estado de la organización</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Definí si esta organización está activa
                      </p>
                    </div>
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => handleInputChange('is_active', checked)}
                      aria-label="Organización activa"
                      className="shrink-0"
                    />
                  </div>

                  {/* Summary info strip */}
                  <div className="grid grid-cols-3 gap-3 p-4 bg-primary/5 rounded-xl border border-primary/15">
                    <div className="text-center">
                      <p className="text-xl font-bold font-display text-foreground">{locations.length}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Locales totales</p>
                    </div>
                    <div className="text-center border-x border-primary/15">
                      <p className="text-xl font-bold font-display text-primary">{locations.filter(l => l.is_active).length}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Activo</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold font-display text-foreground">{formData.is_active ? 'Activa' : 'Inactiva'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Estado</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save button */}
            <div className="sm:hidden">
              <Button
                onClick={saveOrganizationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Guardar configuración de la organización
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Locations tab ── */}
          <TabsContent value="locations" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Administración de locales</CardTitle>
                      <CardDescription className="mt-0.5">
                        Administrá los locales de tu organización. Cada uno puede tener sus propias opciones de entrega, retiro y atención.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {locations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                        <MapPin className="w-6 h-6 text-muted-foreground" />
                      </span>
                      <p className="font-medium text-foreground">Todavía no hay locales</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Creá locales para administrar las sucursales del negocio
                      </p>
                    </div>
                  ) : (
                    <Stagger className="space-y-2.5">
                      {locations.map((location) => (
                        <StaggerItem key={location.id}>
                          <div className="flex items-center justify-between gap-3 p-4 border border-border/60 rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all duration-150 group">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <MapPin className="w-4 h-4" />
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium text-foreground truncate">{location.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{location.address || 'Sin dirección configurada'}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                  <Badge variant={location.is_active ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                                    {location.is_active ? "Activo" : "Inactivo"}
                                  </Badge>
                                  {location.accepts_delivery && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">Entrega</Badge>
                                  )}
                                  {location.accepts_pickup && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">Retiro</Badge>
                                  )}
                                  {location.whatsapp_number && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">WhatsApp</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/settings/location/${location.id}`)}
                              className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg gap-1 group-hover:translate-x-0.5 transition-transform"
                            >
                              <Edit className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline text-xs">Editar</span>
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                          </div>
                        </StaggerItem>
                      ))}
                    </Stagger>
                  )}

                  {/* Stats strip */}
                  {locations.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t border-border/50">
                      {[
                        { label: 'Total', value: locations.length, accent: false },
                        { label: 'Activo', value: locations.filter(l => l.is_active).length, accent: true },
                        { label: 'Con entrega', value: locations.filter(l => l.accepts_delivery).length, accent: true },
                        { label: 'Con retiro', value: locations.filter(l => l.accepts_pickup).length, accent: true },
                      ].map(({ label, value, accent }) => (
                        <div key={label} className="text-center p-3 rounded-xl bg-muted/40">
                          <p className={cn('text-2xl font-bold font-display', accent ? 'text-primary' : 'text-foreground')}>{value}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Reveal>
          </TabsContent>

          {/* ── Business info tab ── */}
          <TabsContent value="businessinfo" className="mt-5">
            <Reveal>
              <BusinessInfoPage />
            </Reveal>
          </TabsContent>
        </Tabs>
      </Reveal>

      {/* Mobile floating save button (org tab only) */}
      {activeTab === 'organization' && (
        <Button
          onClick={saveOrganizationSettings}
          disabled={saving}
          size="icon"
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-elevated hover:shadow-glow transition-all duration-300 z-40 sm:hidden"
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
        </Button>
      )}
    </PageContainer>
  );
};

export default OrganizationSettings;
