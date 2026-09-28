import { useEffect, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ItemNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  value?: string;
  onSave: (notes?: string) => void;
}

export default function ItemNoteDialog({
  open, onOpenChange, itemName, value, onSave,
}: ItemNoteDialogProps) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) setNotes(value || '');
  }, [open, value]);

  const save = () => {
    onSave(notes.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Instrucciones del producto</DialogTitle>
          <DialogDescription>
            Esta nota se mostrará junto a <strong>{itemName}</strong> en la comanda de cocina.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="item-special-instructions" className="flex items-center gap-2">
              <StickyNote className="h-4 w-4" />Preparación especial
            </Label>
            <Textarea
              id="item-special-instructions"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ej.: sin sal, bien cocido, salsa aparte…"
              maxLength={300}
              className="min-h-28"
              autoFocus
            />
            <p className="text-right text-xs text-muted-foreground">{notes.length}/300</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            {value && <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { onSave(undefined); onOpenChange(false); }}>Quitar nota</Button>}
            <Button type="button" onClick={save}>Guardar instrucción</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
