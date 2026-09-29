import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import type { Reservation } from './reservation-card';

interface ReservationFormState {
  customer_name: string;
  customer_phone: string;
  // Start numeric; become strings once the number input is edited (DOM
  // input values are always strings) — parsed back with Number() on submit,
  // same pattern used elsewhere in this codebase.
  party_size: number | string;
  reservation_at: string;
  special_requests: string;
}

const DEFAULT_FORM: ReservationFormState = {
  customer_name: '',
  customer_phone: '',
  party_size: 2,
  reservation_at: '',
  special_requests: '',
};

interface ReservationFormProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (reservation: Reservation) => void;
  organizationId: string;
  locationId: string;
}

export default function ReservationForm({ open, onClose, onCreated, organizationId, locationId }: ReservationFormProps) {
  const [form, setForm] = useState<ReservationFormState>(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field: keyof ReservationFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!form.customer_name.trim()) { setError('Ingresá el nombre de la persona.'); return; }
    if (!form.reservation_at) { setError('Elegí la fecha y la hora.'); return; }
    if (Number(form.party_size) < 1) { setError('La cantidad de personas debe ser al menos 1.'); return; }

    setBusy(true);
    try {
      const { data, error: apiErr } = await api.request<Reservation>('POST', '/reservations', {
        body: {
          organization_id: organizationId,
          location_id: locationId,
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone || undefined,
          party_size: Number(form.party_size),
          reservation_at: form.reservation_at,
          duration_minutes: 90,
          special_requests: form.special_requests || undefined,
        },
      });
      if (apiErr) throw new Error(apiErr.message);
      setForm(DEFAULT_FORM);
      if (onCreated && data) onCreated(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la reserva.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva reserva</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
              <Label htmlFor="res-name">Nombre *</Label>
            <Input
              id="res-name"
              value={form.customer_name}
              onChange={handleChange('customer_name')}
              placeholder="Nombre y apellido"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="res-phone">Teléfono</Label>
              <Input
                id="res-phone"
                value={form.customer_phone}
                onChange={handleChange('customer_phone')}
                placeholder="Ej.: +54 9 11 5555 0000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="res-party">Personas *</Label>
              <Input
                id="res-party"
                type="number"
                min={1}
                value={form.party_size}
                onChange={handleChange('party_size')}
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="res-at">Fecha y hora *</Label>
            <Input
              id="res-at"
              type="datetime-local"
              value={form.reservation_at}
              onChange={handleChange('reservation_at')}
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="res-requests">Notas</Label>
            <Textarea
              id="res-requests"
              value={form.special_requests}
              onChange={handleChange('special_requests')}
              placeholder="Alergias o preferencias de ubicación"
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Volver
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Crear reserva'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
