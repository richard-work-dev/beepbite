import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChefHat, Clock3, Copy, KeyRound, Loader2, Mail,
  RefreshCw, Search, Shield, ShieldCheck, Trash2, UserCog, UserPlus,
  UserRound, Users, XCircle,
} from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import {
  changeMemberRole, inviteMember, listActiveMembers, listMemberInvites,
  removeMember, renewMemberInvite, revokeMemberInvite,
  type Member, type MemberInvite,
} from '@/services/member-invites';

const ROLE_DEFINITIONS = [
  {
    value: 'admin', label: 'Administrador', icon: ShieldCheck,
    description: 'Gestiona el negocio y a los encargados. No puede modificar al propietario.',
    permissions: ['Caja', 'Cocina', 'Menú', 'Reportes', 'Usuarios'],
  },
  {
    value: 'manager', label: 'Encargado', icon: Shield,
    description: 'Opera el local y administra al personal operativo durante el turno.',
    permissions: ['Caja', 'Cocina', 'Menú', 'Reportes', 'Personal operativo'],
  },
  {
    value: 'staff', label: 'Caja', icon: UserRound,
    description: 'Crea pedidos, cobra y trabaja en el punto de venta.',
    permissions: ['Caja y pedidos'],
  },
  {
    value: 'pos', label: 'Punto de venta', icon: UserCog,
    description: 'Acceso dedicado al punto de venta, sin administración.',
    permissions: ['Caja y pedidos'],
  },
  {
    value: 'kitchen', label: 'Cocina', icon: ChefHat,
    description: 'Ve las comandas y actualiza sus estados de preparación.',
    permissions: ['Cocina y despacho'],
  },
] as const;

type RoleValue = typeof ROLE_DEFINITIONS[number]['value'];

const ROLE_RANK: Record<string, number> = {
  owner: 4, admin: 3, manager: 2, staff: 1, pos: 1, kitchen: 1,
};

function roleDefinition(role: string) {
  return ROLE_DEFINITIONS.find((item) => item.value === role);
}

function roleLabel(role: string) {
  if (role === 'owner') return 'Propietario';
  return roleDefinition(role)?.label ?? role;
}

function initials(member: Member) {
  const source = member.full_name?.trim() || member.email;
  return source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function registrationUrl(invite: MemberInvite) {
  if (!invite.registration_token) return '';
  const url = new URL('/signup', window.location.origin);
  url.searchParams.set('email', invite.email);
  url.searchParams.set('invite', invite.registration_token);
  return url.toString();
}

function inviteExpired(invite: MemberInvite) {
  if (invite.is_expired) return true;
  if (!invite.expires_at) return true;
  return new Date(invite.expires_at).getTime() <= Date.now();
}

interface PendingAction {
  type: 'role' | 'remove';
  member: Member;
  nextRole?: RoleValue;
}

export default function Members() {
  const { toast } = useToast();
  const { user, activeMembership } = useAuth();
  const actorRole = String(activeMembership?.role || '');
  const actorRank = ROLE_RANK[actorRole] ?? 0;
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<MemberInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleValue>('staff');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareEmail, setShareEmail] = useState('');

  const assignableRoles = useMemo(
    () => ROLE_DEFINITIONS.filter((item) => actorRank > (ROLE_RANK[item.value] ?? 0)),
    [actorRank],
  );

  useEffect(() => {
    if (!assignableRoles.some((item) => item.value === role)) {
      setRole(assignableRoles[0]?.value ?? 'staff');
    }
  }, [assignableRoles, role]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [active, pending] = await Promise.all([listActiveMembers(), listMemberInvites()]);
      setMembers(active);
      setInvites(pending.filter((invite) => invite.status === 'pending'));
    } catch (error) {
      toast({
        variant: 'destructive', title: 'No se pudo cargar el equipo',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return members;
    return members.filter((member) => member.email.toLowerCase().includes(normalized)
      || member.full_name?.toLowerCase().includes(normalized)
      || roleLabel(member.role).toLowerCase().includes(normalized));
  }, [members, query]);

  const createInvite = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) return;
    setSaving(true);
    try {
      const invite = await inviteMember(normalizedEmail, role);
      setEmail('');
      setInviteOpen(false);
      await load();
      if (invite.status === 'accepted') {
        toast({ title: 'Usuario incorporado', description: 'La cuenta ya existía y recibió acceso inmediatamente.' });
        return;
      }
      setShareEmail(invite.email);
      setShareUrl(registrationUrl(invite));
      toast({ title: 'Invitación creada', description: 'Compartí el enlace seguro con la persona invitada.' });
    } catch (error) {
      toast({
        variant: 'destructive', title: 'No se pudo crear la invitación',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async (url = shareUrl) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Enlace copiado', description: 'Vence en 7 días y solo sirve para el correo invitado.' });
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo copiar', description: 'Seleccioná el enlace y copialo manualmente.' });
    }
  };

  const regenerateLink = async (invite: MemberInvite) => {
    setBusyId(invite.id);
    try {
      const renewed = await renewMemberInvite(invite.id);
      setShareEmail(renewed.email);
      setShareUrl(registrationUrl(renewed));
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo generar el enlace', description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (invite: MemberInvite) => {
    setBusyId(invite.id);
    try {
      await revokeMemberInvite(invite.id);
      toast({ title: 'Invitación cancelada' });
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo cancelar', description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusyId(null);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const { member } = pendingAction;
    setBusyId(member.profile_id);
    try {
      if (pendingAction.type === 'role' && pendingAction.nextRole) {
        await changeMemberRole(member.profile_id, pendingAction.nextRole);
        toast({ title: 'Rol actualizado', description: `${member.full_name || member.email} ahora tiene el rol ${roleLabel(pendingAction.nextRole)}.` });
      } else {
        await removeMember(member.profile_id);
        toast({ title: 'Acceso eliminado', description: `${member.email} ya no puede ingresar a la tienda.` });
      }
      setPendingAction(null);
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo completar la acción', description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusyId(null);
    }
  };

  const canManage = (member: Member) => member.profile_id !== user?.id
    && member.role !== 'owner'
    && actorRank > (ROLE_RANK[member.role] ?? 0);

  return (
    <PageContainer className="space-y-6 pb-24">
      <PageHeader
        title="Usuarios y roles"
        description="Invitá personas con un enlace seguro y controlá exactamente qué puede hacer cada rol."
        icon={Users}
        actions={assignableRoles.length > 0 ? (
          <Button onClick={() => setInviteOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Invitar usuario</Button>
        ) : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-5 w-5 text-primary" /><div><p className="text-2xl font-bold">{members.length}</p><p className="text-xs text-muted-foreground">Usuarios activos</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Mail className="h-5 w-5 text-warning" /><div><p className="text-2xl font-bold">{invites.length}</p><p className="text-xs text-muted-foreground">Invitaciones pendientes</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><ShieldCheck className="h-5 w-5 text-success" /><div><p className="text-sm font-bold">{roleLabel(actorRole)}</p><p className="text-xs text-muted-foreground">Tu nivel de acceso</p></div></CardContent></Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="space-y-1 text-sm"><p className="font-semibold">Registro privado por invitación</p><p className="text-muted-foreground">Cada enlace es único, queda vinculado al correo invitado, vence en 7 días y se invalida al generar uno nuevo.</p></div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card"><CardContent className="flex items-start gap-3 p-4"><Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="space-y-1 text-sm"><p className="font-semibold">Jerarquía de acceso</p><p className="text-muted-foreground">{actorRole === 'owner' ? 'Como propietario, podés invitar administradores. Los administradores gestionan encargados y equipo operativo, pero no pueden cambiar al propietario ni a otros administradores.' : actorRole === 'admin' ? 'Tu rol permite invitar encargados y equipo operativo. Solo el propietario puede invitar, cambiar o quitar administradores.' : actorRole === 'manager' ? 'Podés invitar personal de caja, punto de venta y cocina. La administración de encargados y administradores queda reservada a roles superiores.' : 'Tu rol no puede administrar invitaciones ni cambiar roles. Pedile acceso a un administrador o al propietario.'}</p><p className="text-xs text-muted-foreground">Los permisos se validan también en el servidor; no se puede asignar un rol del mismo nivel o superior.</p></div></CardContent></Card>

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="active">Activos ({members.length})</TabsTrigger>
          <TabsTrigger value="pending">Pendientes ({invites.length})</TabsTrigger>
          <TabsTrigger value="roles">Permisos por rol</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3">
          <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, correo o rol" className="pl-9" aria-label="Buscar usuarios" /></div>
          {loading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filteredMembers.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No se encontraron usuarios.</CardContent></Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {filteredMembers.map((member) => {
                const editable = canManage(member);
                const definition = roleDefinition(member.role);
                const MemberIcon = definition?.icon ?? ShieldCheck;
                return (
                  <Card key={member.profile_id} className={member.profile_id === user?.id ? 'border-primary/30' : undefined}>
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-11 w-11"><AvatarFallback className="bg-primary/10 font-bold text-primary">{initials(member)}</AvatarFallback></Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{member.full_name || member.email}</p>{member.profile_id === user?.id && <Badge variant="secondary">Tu cuenta</Badge>}</div>
                          <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" />Desde {new Date(member.joined_at).toLocaleDateString('es-AR')}</p>
                        </div>
                        <Badge variant="outline" className="gap-1"><MemberIcon className="h-3 w-3" />{roleLabel(member.role)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{member.role === 'owner' ? 'Control total y propiedad de la tienda.' : definition?.description}</p>
                      {editable ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Select value={member.role} onValueChange={(nextRole) => setPendingAction({ type: 'role', member, nextRole: nextRole as RoleValue })} disabled={busyId === member.profile_id}>
                            <SelectTrigger className="flex-1" aria-label={`Cambiar rol de ${member.email}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{assignableRoles.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                          </Select>
                          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setPendingAction({ type: 'remove', member })} disabled={busyId === member.profile_id}><Trash2 className="mr-2 h-4 w-4" />Quitar acceso</Button>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{member.profile_id === user?.id ? 'Por seguridad no podés cambiar ni quitar tu propia cuenta.' : 'Solo un nivel superior puede modificar este usuario.'}</div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-3">
          {loading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : invites.length === 0 ? (
            <Card><CardContent className="p-8 text-center"><Check className="mx-auto mb-2 h-8 w-8 text-success" /><p className="font-medium">No hay invitaciones pendientes</p><p className="text-sm text-muted-foreground">Todos los accesos enviados ya fueron utilizados o cancelados.</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {invites.map((invite) => {
                const expired = inviteExpired(invite);
                return (
                  <Card key={invite.id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{invite.email}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Badge variant="outline">{roleLabel(invite.role)}</Badge><span>Creada {new Date(invite.created_at).toLocaleDateString('es-AR')}</span><Badge variant={expired ? 'destructive' : 'secondary'}>{expired ? 'Vencida' : 'Vigente'}</Badge></div></div>
                    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void regenerateLink(invite)} disabled={busyId === invite.id}>{busyId === invite.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{expired ? 'Renovar enlace' : 'Generar enlace nuevo'}</Button><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void revoke(invite)} disabled={busyId === invite.id}><XCircle className="mr-2 h-4 w-4" />Cancelar</Button></div>
                  </CardContent></Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="roles">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Card className="border-primary/30"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-primary" />Propietario</CardTitle><CardDescription>Control total. Su cuenta no puede ser modificada desde esta pantalla.</CardDescription></CardHeader><CardContent><Badge>Todos los permisos</Badge></CardContent></Card>
            {ROLE_DEFINITIONS.map((item) => { const Icon = item.icon; return <Card key={item.value}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-5 w-5 text-primary" />{item.label}</CardTitle><CardDescription>{item.description}</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-1.5">{item.permissions.map((permission) => <Badge key={permission} variant="secondary">{permission}</Badge>)}</CardContent></Card>; })}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Invitar usuario</DialogTitle><DialogDescription>Elegí el rol inicial. La persona creará su propia contraseña desde un enlace seguro.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            {actorRole === 'owner' && role === 'admin' && <div role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><p className="font-semibold">Acceso de administrador</p><p className="mt-1 text-muted-foreground">Podrá gestionar el negocio, reportes, configuración y miembros por debajo de su nivel. No compartas la invitación con nadie más: queda vinculada al correo indicado.</p></div>}
            <div className="space-y-1.5"><Label htmlFor="member-email">Correo electrónico</Label><Input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@correo.com" autoComplete="email" /></div>
            <div className="space-y-2"><Label>Rol inicial</Label><div className="grid gap-2 sm:grid-cols-2">{assignableRoles.map((item) => { const Icon = item.icon; const selected = role === item.value; return <button key={item.value} type="button" onClick={() => setRole(item.value)} className={`rounded-xl border p-3 text-left transition ${selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:bg-muted'}`} aria-pressed={selected}><div className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-primary" />{item.label}</div><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></button>; })}</div></div>
            <Button className="w-full" disabled={!email.trim().includes('@') || saving || assignableRoles.length === 0} onClick={() => void createInvite()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}Crear invitación</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(shareUrl)} onOpenChange={(open) => { if (!open) setShareUrl(''); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Compartir enlace de registro</DialogTitle><DialogDescription>Enviáselo únicamente a {shareEmail}. Al generar otro enlace, este dejará de funcionar.</DialogDescription></DialogHeader>
          <div className="space-y-3"><div className="flex gap-2"><Input value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Enlace de registro" /><Button size="icon" onClick={() => void copyUrl()} aria-label="Copiar enlace"><Copy className="h-4 w-4" /></Button></div><p className="flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />El enlace vence en 7 días y se consume al crear la cuenta.</p><Button className="w-full" onClick={() => void copyUrl()}><Copy className="mr-2 h-4 w-4" />Copiar enlace</Button></div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingAction)} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{pendingAction?.type === 'remove' ? '¿Quitar acceso a la tienda?' : '¿Confirmar el cambio de rol?'}</AlertDialogTitle><AlertDialogDescription>{pendingAction?.type === 'remove' ? `${pendingAction.member.full_name || pendingAction.member.email} perderá el acceso inmediatamente.` : `${pendingAction?.member.full_name || pendingAction?.member.email} pasará de ${roleLabel(pendingAction?.member.role || '')} a ${roleLabel(pendingAction?.nextRole || '')}. Sus permisos cambiarán al volver a cargar la aplicación.`}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction variant={pendingAction?.type === 'remove' ? 'destructive' : 'default'} onClick={() => void confirmAction()}>{pendingAction?.type === 'remove' ? 'Quitar acceso' : 'Cambiar rol'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
