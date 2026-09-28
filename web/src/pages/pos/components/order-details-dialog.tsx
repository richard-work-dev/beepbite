import { useEffect, useState } from 'react';
import { Check, Phone, StickyNote, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import CustomerSearch from './customer-search';
import type { CustomerSearchResult } from '@/services/customers';

export interface OrderDetails {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
}

interface OrderDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderLabel: string;
  orderType: 'dine_in' | 'takeaway';
  value: OrderDetails;
  onSave: (value: OrderDetails) => void;
}

export default function OrderDetailsDialog({
  open, onOpenChange, orderLabel, orderType, value, onSave,
}: OrderDetailsDialogProps) {
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setCustomerId(value.customerId);
    setCustomerName(value.customerName || '');
    setCustomerPhone(value.customerPhone || '');
    setNotes(value.notes || '');
  }, [open, value]);

  const selectCustomer = (customer: CustomerSearchResult) => {
    setCustomerId(customer.id);
    setCustomerName(customer.name || '');
    setCustomerPhone(customer.phone || '');
  };

  const clearCustomer = () => {
    setCustomerId(undefined);
    setCustomerName('');
    setCustomerPhone('');
  };

  const save = () => {
    onSave({
      customerId,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Datos del pedido</DialogTitle>
          <DialogDescription>
            {orderLabel} · {orderType === 'dine_in' ? 'Consumo en el local' : 'Para llevar'}. Estos datos aparecerán en la comanda de cocina.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Buscar cliente registrado</Label>
            <CustomerSearch onSelect={selectCustomer} placeholder="Buscar cliente por nombre o teléfono…" limit={8} />
            {customerId && (
              <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 font-medium text-success"><Check className="h-4 w-4" />Cliente registrado seleccionado</span>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={clearCustomer} aria-label="Quitar cliente seleccionado"><X className="h-4 w-4" /></Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="order-customer-name">Nombre del cliente</Label>
              <div className="relative"><UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="order-customer-name" value={customerName} onChange={(event) => { setCustomerId(undefined); setCustomerName(event.target.value); }} placeholder="Mostrador o nombre" className="pl-9" maxLength={120} /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-customer-phone">Teléfono</Label>
              <div className="relative"><Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="order-customer-phone" type="tel" value={customerPhone} onChange={(event) => { setCustomerId(undefined); setCustomerPhone(event.target.value); }} placeholder="Opcional" className="pl-9" maxLength={40} /></div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-notes" className="flex items-center gap-2"><StickyNote className="h-4 w-4" />Observaciones generales</Label>
            <Textarea id="order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej.: entregar primero las bebidas, cliente espera afuera…" maxLength={500} className="min-h-24" />
            <p className="text-right text-xs text-muted-foreground">{notes.length}/500</p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" onClick={save}>Guardar datos del pedido</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
