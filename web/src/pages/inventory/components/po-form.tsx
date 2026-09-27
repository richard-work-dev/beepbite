import { useState, useEffect, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api-client';
import { Plus, Trash2 } from 'lucide-react';
import type { Supplier, InventoryItemBrief } from '../types';

interface POFormLine {
  inventory_item_id: string;
  ordered_quantity: string;
  ordered_unit: string;
  ordered_unit_price: string; // major units — converted to cents on submit
}

const EMPTY_LINE: POFormLine = {
  inventory_item_id: '',
  ordered_quantity: '',
  ordered_unit: '',
  ordered_unit_price: '', // major units — converted to cents on submit
};

// The POST /inventory/purchase-orders request body this form builds.
export interface POFormPayload {
  location_id: string;
  supplier_id: string;
  po_number: string;
  expected_delivery_date: string;
  notes: string;
  lines: {
    inventory_item_id: string;
    ordered_quantity: number;
    ordered_unit: string;
    ordered_unit_price_cents: number;
  }[];
}

function majorToCents(str: string): number {
  const v = parseFloat(str);
  return isNaN(v) ? 0 : Math.round(v * 100);
}

interface POFormProps {
  locationId: string;
  suppliers: Supplier[];
  onSubmit: (payload: POFormPayload) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
}

export function POForm({ locationId, suppliers, onSubmit, onCancel, saving }: POFormProps) {
  const [supplierId, setSupplierId] = useState('none');
  const [poNumber, setPoNumber] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<POFormLine[]>([{ ...EMPTY_LINE }]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemBrief[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!locationId) return;
    api.from('inventory_items')
      .select('id, name, unit')
      .eq('location_id', locationId)
      .order('name', { ascending: true })
      .then(({ data }) => setInventoryItems(data || []))
      .catch((err: unknown) => {
        // A network-level failure (fetch() itself rejecting) previously
        // left this as an unhandled rejection — there's no dedicated
        // loading/error state for this dropdown either way (it just stays
        // empty), but this at least logs it instead of failing silently.
        console.error('No se pudieron cargar los insumos para la orden:', err);
		setErr('No se pudieron cargar los insumos. Cerrá el formulario e intentá nuevamente.');
      });
  }, [locationId]);

  function setLine<K extends keyof POFormLine>(idx: number, field: K, value: POFormLine[K]) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function lineTotal(line: POFormLine): string {
    const qty = parseFloat(line.ordered_quantity) || 0;
    const price = parseFloat(line.ordered_unit_price) || 0;
    return (qty * price).toFixed(2);
  }

  function grandTotal(): string {
    return lines.reduce((sum, l) => {
      return sum + (parseFloat(l.ordered_quantity) || 0) * (parseFloat(l.ordered_unit_price) || 0);
    }, 0).toFixed(2);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!poNumber.trim()) { setErr('El número de orden es obligatorio'); return; }
    if (lines.length === 0) { setErr('Agregá al menos un producto'); return; }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.inventory_item_id) { setErr(`Producto ${i + 1}: seleccioná un insumo`); return; }
      if (!l.ordered_quantity || parseFloat(l.ordered_quantity) <= 0) { setErr(`Producto ${i + 1}: la cantidad debe ser mayor que cero`); return; }
      if (!l.ordered_unit.trim()) { setErr(`Producto ${i + 1}: la unidad es obligatoria`); return; }
    }
    setErr('');

    const payload = {
      location_id: locationId,
      supplier_id: supplierId === 'none' ? '' : supplierId,
      po_number: poNumber.trim(),
      expected_delivery_date: expectedDate || '',
      notes: notes.trim(),
      lines: lines.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        ordered_quantity: parseFloat(l.ordered_quantity),
        ordered_unit: l.ordered_unit.trim(),
        ordered_unit_price_cents: majorToCents(l.ordered_unit_price),
      })),
    };

    await onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="po_number">Número de orden <span className="text-destructive">*</span></Label>
          <Input id="po_number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2024-001" required />
        </div>
        <div className="space-y-1">
          <Label>Proveedor</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar proveedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Sin proveedor —</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="expected_date">Fecha estimada de entrega</Label>
          <Input id="expected_date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Notas</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Productos</Label>
          <Button type="button" size="sm" variant="outline" onClick={addLine} className="border-primary/25 text-primary hover:bg-primary/10">
            <Plus className="w-4 h-4 mr-1" /> Agregar producto
          </Button>
        </div>

        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-end border border-border rounded p-2 bg-muted/30">
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">Insumo</Label>
              <Select value={line.inventory_item_id} onValueChange={(v) => {
                const item = inventoryItems.find((i) => i.id === v);
                setLine(idx, 'inventory_item_id', v);
                if (item && !line.ordered_unit) setLine(idx, 'ordered_unit', item.unit);
              }}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((it) => (
                    <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Cantidad</Label>
              <Input className="h-8 text-sm" type="number" min="0.001" step="0.001" value={line.ordered_quantity} onChange={(e) => setLine(idx, 'ordered_quantity', e.target.value)} />
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Unidad</Label>
              <Input className="h-8 text-sm" value={line.ordered_unit} onChange={(e) => setLine(idx, 'ordered_unit', e.target.value)} placeholder="kg" />
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Costo unitario</Label>
              <Input className="h-8 text-sm" type="number" min="0" step="0.01" value={line.ordered_unit_price} onChange={(e) => setLine(idx, 'ordered_unit_price', e.target.value)} placeholder="0.00" />
            </div>

            <div className="col-span-1 space-y-1">
              <Label className="text-xs">Subtotal</Label>
              <p className="text-sm font-medium h-8 flex items-center tabular-nums">{lineTotal(line)}</p>
            </div>

            <div className="col-span-1 flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(idx)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10" disabled={lines.length === 1}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex justify-end text-sm font-semibold text-foreground pr-2 tabular-nums">
          Total: {grandTotal()}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? 'Creando…' : 'Crear orden de compra'}
        </Button>
      </div>
    </form>
  );
}
