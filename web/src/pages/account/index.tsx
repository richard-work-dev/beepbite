import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import SecuritySettings from "@/pages/settings/security";
import DataPrivacySettings from "@/pages/settings/account";
import { User, Save, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

interface AccountFormData {
  full_name: string;
  username: string;
}

const Account = () => {
  const { user, fetchUserProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [formData, setFormData] = useState<AccountFormData>({
    full_name: '',
    username: ''
  });

  useEffect(() => {
    if (user) {
      // loadUserData() is fully try/catch/finally-wrapped below.
      void loadUserData();
    }
  }, [user]);

  const loadUserData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, username')
        .eq('id', user.id)
        .single();
      
      if (error) {
        console.error('Error loading user data:', error);
      } else {
        setFormData({
          full_name: data?.full_name || '',
          username: data?.username || ''
        });
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof AccountFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear save message when user starts typing
    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const validateForm = () => {
    const errors = [];
    
    // Username validation
    if (formData.username.length < 3) {
      errors.push('El nombre de usuario debe tener al menos 3 caracteres');
    }
    
    return errors;
  };

  const saveAccount = async () => {
    if (!user) return;
    
    const errors = validateForm();
    if (errors.length > 0) {
      setSaveMessage(errors[0]);
      setTimeout(() => setSaveMessage(''), 5000);
      return;
    }
    
    setSaving(true);
    setSaveMessage('');
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name || null,
          username: formData.username
        })
        .eq('id', user.id);
      
      if (error) throw error;
      
      setSaveMessage('Cuenta actualizada correctamente.');
      
      // Clear message after 3 seconds
      setTimeout(() => {
        setSaveMessage('');
      }, 3000);
      
      await fetchUserProfile();
      
    } catch (error) {
      console.error('Error saving account:', error);

      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        setSaveMessage('Ese nombre de usuario ya está en uso. Elegí otro.');
      } else {
        setSaveMessage('No se pudo actualizar la cuenta. Intentá nuevamente.');
      }
      
      setTimeout(() => {
        setSaveMessage('');
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name?: string | null, username?: string | null, email?: string | null) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (username) {
      return username.slice(0, 2).toUpperCase();
    }
    if (email) {
      return email.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded" />
        <Skeleton className="h-64 w-full rounded" />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Configuración de la cuenta"
        description="Administrá la información y las preferencias de tu perfil"
        icon={User}
      />

      {/* Save Message */}
      {saveMessage && (
        <div className={cn(
          "flex items-center gap-2 px-4 py-3 rounded-lg",
          saveMessage.includes('correctamente')
            ? "bg-beepbite-success/10 text-beepbite-success border border-beepbite-success/30"
            : "bg-destructive/10 text-destructive border border-destructive/30"
        )}>
          {saveMessage.includes('correctamente') ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">{saveMessage}</span>
        </div>
      )}

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="security">Seguridad</TabsTrigger>
          <TabsTrigger value="privacy">Datos y privacidad</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6 mt-2">

      {/* Save Buttons */}
      {/* Save Button - Fixed for mobile */}
      <Button
        onClick={saveAccount}
        disabled={saving}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-primary-foreground shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="lg"
      >
        {saving ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Save className="w-6 h-6" />
        )}
      </Button>

      {/* Desktop Save Button */}
      <div className="hidden sm:flex justify-end">
        <Button 
          onClick={saveAccount}
          disabled={saving}
          className="beepbite-gradient text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Guardar cambios
            </>
          )}
        </Button>
      </div>

      {/* Account Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Información del perfil
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Nombre completo
              </label>
              <Input
                placeholder="Tu nombre completo"
                value={formData.full_name}
                onChange={(e) => handleInputChange('full_name', e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
Este es el nombre que verán los demás usuarios
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Nombre de usuario
              </label>
              <Input
                placeholder="Elegí un nombre de usuario único"
                value={formData.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
Debe ser único y tener al menos 3 caracteres
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Correo electrónico
              </label>
              <Input
                value={user?.email || ''}
                disabled={true}
                className="w-full bg-muted"
              />
              <p className="text-xs text-muted-foreground mt-1">
                El correo electrónico no se puede modificar
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Avatar Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Configuración del avatar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current Avatar Preview */}
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-border">
                <AvatarFallback className="bg-muted text-foreground font-semibold text-lg">
                  {getInitials(formData.full_name, formData.username, user?.email)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-foreground">Avatar actual</p>
                <p className="text-xs text-muted-foreground">
                  Se muestran las iniciales de tu nombre o correo
                </p>
              </div>
            </div>

            {/* Avatar Help */}
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-primary mb-1">
                    Información del avatar
                  </p>
                  <ul className="text-xs text-primary/80 space-y-1">
                    <li>• El avatar se genera automáticamente a partir de tu nombre o correo</li>
                    <li>• Tus iniciales se muestran dentro de un círculo de color</li>
                    <li>• No necesitás subir ni enlazar imágenes externas</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            Información de la cuenta
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-foreground">Tipo de cuenta</label>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs font-medium bg-muted text-foreground border-border">
                  Cuenta con correo
                </Badge>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Miembro desde</label>
              <p className="text-sm text-muted-foreground mt-1">
                {typeof user?.created_at === 'string' ? new Date(user.created_at).toLocaleDateString('es-AR') : 'Desconocido'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-2">
          <SecuritySettings />
        </TabsContent>

        <TabsContent value="privacy" className="mt-2">
          <DataPrivacySettings />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
};

export default Account;
