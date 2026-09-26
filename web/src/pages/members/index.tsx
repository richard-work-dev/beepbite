import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Users, XCircle, Trash2, Shield, ChefHat, UserRound, MonitorPlay, Loader2 } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { inviteMember, listActiveMembers, listMemberInvites, removeMember, revokeMemberInvite, type Member, type MemberInvite } from '@/services/member-invites';
import { api } from '@/lib/api-client';

const roles = [
  { value: 'staff', label: 'Caja', icon: UserRound },
  { value: 'pos', label: 'TPV', icon: UserRound },
  { value: 'kitchen', label: 'Cocina', icon: ChefHat },
  { value: 'manager', label: 'Encargado', icon: Shield },
  { value: 'admin', label: 'Administrador', icon: Shield },
];

function roleLabel(role: string) { return roles.find((item) => item.value === role)?.label ?? role; }

export default function Members() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<MemberInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [active, pending] = await Promise.all([listActiveMembers(), listMemberInvites()]);
      setMembers(active);
      setInvites(pending);
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo cargar el equipo', description: error instanceof Error ? error.message : undefined });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const createInvite = async () => {
    setSaving(true);
    try {
      await inviteMember(email, role);
      toast({ title: 'Invitación creada', description: 'La persona se incorporará al registrarse con ese correo.' });
      setEmail(''); setRole('staff'); setDialogOpen(false); await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo crear la invitación', description: error instanceof Error ? error.message : undefined });
    } finally { setSaving(false); }
  };

  const changeRole = async (member: Member, nextRole: string) => {
    try {
      const { error } = await api.request('PATCH', `/members/${member.profile_id}`, { body: { role: nextRole } });
      if (error) throw new Error(error.message);
      toast({ title: 'Rol actualizado' }); await load();
    } catch (error) { toast({ variant: 'destructive', title: 'No se pudo actualizar el rol', description: error instanceof Error ? error.message : undefined }); }
  };

  const remove = async (member: Member) => {
    try { await removeMember(member.profile_id); toast({ title: 'Acceso eliminado' }); await load(); }
    catch (error) { toast({ variant: 'destructive', title: 'No se pudo quitar el acceso', description: error instanceof Error ? error.message : undefined }); }
  };

  return <PageContainer className="space-y-6 pb-20">
    <PageHeader title="Equipo y usuarios" description="Invitá personas, asigná sus roles y retirales el acceso cuando sea necesario." icon={Users}
      actions={<Button onClick={() => setDialogOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Invitar usuario</Button>} />

    <Card><CardContent className="p-5"><div className="flex items-center gap-3"><MonitorPlay className="h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">Caja, cocina y reparto solo ven sus áreas. Administradores y encargados gestionan este equipo.</p></div></CardContent></Card>

    <section className="space-y-3" aria-labelledby="active-members"><h2 id="active-members" className="text-lg font-semibold">Usuarios activos</h2>
      {loading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : members.length === 0 ? <Card><CardContent className="p-8 text-center text-muted-foreground">Todavía no hay usuarios invitados.</CardContent></Card> :
        <div className="grid gap-3 md:grid-cols-2">{members.map((member) => <Card key={member.profile_id}><CardContent className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{member.full_name || member.email}</p><p className="truncate text-sm text-muted-foreground">{member.email}</p></div><Badge variant="outline">{roleLabel(member.role)}</Badge><Select value={member.role} onValueChange={(next) => void changeRole(member, next)}><SelectTrigger className="w-32" aria-label={`Cambiar rol de ${member.email}`}><SelectValue /></SelectTrigger><SelectContent>{roles.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" aria-label={`Quitar a ${member.email}`} onClick={() => void remove(member)}><Trash2 className="h-4 w-4 text-destructive" /></Button></CardContent></Card>)}</div>}
    </section>

    {invites.filter((invite) => invite.status === 'pending').length > 0 && <section className="space-y-3" aria-labelledby="pending-invites"><h2 id="pending-invites" className="text-lg font-semibold">Invitaciones pendientes</h2><div className="space-y-2">{invites.filter((invite) => invite.status === 'pending').map((invite) => <Card key={invite.id}><CardContent className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{invite.email}</p><p className="text-sm text-muted-foreground">{roleLabel(invite.role)}</p></div><Button variant="ghost" size="sm" onClick={() => void revokeMemberInvite(invite.id).then(load)}><XCircle className="mr-2 h-4 w-4" />Cancelar</Button></CardContent></Card>)}</div></section>}

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>Invitar usuario</DialogTitle><DialogDescription>Elegí el acceso que tendrá dentro de la tienda.</DialogDescription></DialogHeader><div className="space-y-4"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@ejemplo.com" aria-label="Correo electrónico" /><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roles.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Button className="w-full" disabled={!email || saving} onClick={() => void createInvite()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar invitación</Button></div></DialogContent></Dialog>
  </PageContainer>;
}

