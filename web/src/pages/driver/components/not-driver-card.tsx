import { Truck, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shown when GET /driver/assignments returns empty or 403 — user is not a
 * driver at any restaurant yet.
 *
 * Props:
 *   userEmail {string|undefined}
 */
export default function NotDriverCard({ userEmail }: { userEmail?: string }) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-6 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Truck className="w-8 h-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-display text-foreground">
            Todavía no estás registrado como repartidor
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
            Pedí al restaurante que te contrató que te invite como repartidor
            usando el correo con el que te registraste.
          </p>
        </div>

        {userEmail && (
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-sm">
            <Mail className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="font-mono text-primary break-all">{userEmail}</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground/70">
          Cuando recibas la invitación, tus entregas aparecerán aquí.
        </p>
      </CardContent>
    </Card>
  );
}
