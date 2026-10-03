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
      <DialogContent className="bottom-0 left-0 top-auto flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-x-0 border-b-0 p-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[min(90dvh,760px)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 text-left sm:px-6 sm:py-5 sm:pr-12">
          <DialogTitle>Datos del pedido</DialogTitle>
          <DialogDescription>
            {orderLabel} · {orderType === 'dine_in' ? 'Consumo en el local' : 'Para llevar'}. Estos datos aparecerán en la comanda de cocina.
          </DialogDescription>
          <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[11px]" aria-label="Paso actual del pedido">
            <div className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 font-semibold text-primary"><span className="mr-1">1</span> Productos</div>
            <div className="rounded-md border border-primary bg-primary px-2 py-1.5 font-semibold text-primary-foreground"><span className="mr-1">2</span> Datos</div>
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-muted-foreground"><span className="mr-1">3</span> Revisar</div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <section className="space-y-3" aria-labelledby="order-customer-heading">
            <div>
              <h3 id="order-customer-heading" className="font-semibold text-foreground">Cliente</h3>
              <p className="text-xs text-muted-foreground">El nombre y el teléfono quedarán visibles en el pedido y en cocina.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="order-customer-name">Nombre del cliente</Label>
                <div className="relative">
                  <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="order-customer-name" value={customerName} onChange={(event) => { setCustomerId(undefined); setCustomerName(event.target.value); }} placeholder="Ej.: María López" className="h-12 pl-9 text-base" maxLength={120} autoComplete="name" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-customer-phone">Teléfono</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="order-customer-phone" type="tel" inputMode="tel" value={customerPhone} onChange={(event) => { setCustomerId(undefined); setCustomerPhone(event.target.value); }} placeholder="Ej.: 3755 123456" className="h-12 pl-9 text-base" maxLength={40} autoComplete="tel" />
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-2 border-t border-border pt-4">
            <Label>Buscar cliente registrado <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <CustomerSearch onSelect={selectCustomer} placeholder="Buscar por nombre o teléfono…" limit={8} />
            {customerId && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-medium text-success"><Check className="h-4 w-4 shrink-0" /><span className="truncate">Cliente registrado seleccionado</span></span>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={clearCustomer} aria-label="Quitar cliente seleccionado"><X className="h-4 w-4" /></Button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-notes" className="flex items-center gap-2"><StickyNote className="h-4 w-4" />Observaciones generales</Label>
            <Textarea id="order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej.: entregar primero las bebidas, cliente espera afuera…" maxLength={500} className="min-h-24" />
            <p className="text-right text-xs text-muted-foreground">{notes.length}/500</p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:flex sm:justify-end sm:px-6 sm:pb-5">
          <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" className="h-11 sm:h-10" onClick={save}>Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
