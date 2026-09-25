import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserPlus } from 'lucide-react';
import type { PendingInvite } from '@/context/auth-context';

interface InviteBannerProps {
  pendingInvites: PendingInvite[] | null | undefined;
  onOpenInviteDialog: () => void;
}

const InviteBanner = ({ pendingInvites, onOpenInviteDialog }: InviteBannerProps) => {
  if (!pendingInvites || pendingInvites.length === 0) {
    return null;
  }

  return (
    <Card className="border-orange-200 bg-orange-50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-orange-900">
                {pendingInvites.length} {pendingInvites.length > 1 ? 'invitaciones pendientes' : 'invitación pendiente'}
              </h3>
              <p className="text-sm text-orange-700">
                Te invitaron a unirte {pendingInvites.length > 1 ? 'a varios negocios' : 'a un negocio'}. Revisá y respondé las invitaciones.
              </p>
            </div>
          </div>
          <Button
            onClick={onOpenInviteDialog}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Revisar invitaciones
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default InviteBanner;
