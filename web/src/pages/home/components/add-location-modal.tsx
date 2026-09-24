import { useState, useMemo, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { MapPin, Loader2 } from 'lucide-react';
import AddressAutocomplete from '@/components/address-autocomplete';
import { countryOptions } from '@/lib/locale-data';

interface AddLocationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (location: { id: string; [key: string]: unknown }) => void;
}

const AddLocationModal = ({ open, onOpenChange, onSuccess }: AddLocationModalProps) => {
  const { activeOrganization, fetchLocations } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  // No preselected country. An operator adding their first location has to say
  // where it is; guessing on their behalf is how every other country-specific
  // default in this codebase got there.
  //
  // This is an ISO 3166-1 alpha-2 CODE, not a display name. It used to be a
  // free-text field holding "South Africa", which migration 056 would now reject
  // outright — locations.country carries a CHECK of ^[A-Z]{2}$.
  const [country, setCountry] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setAddress('');
    setCity('');
    setCountry('');
    setSubmitting(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const isValid = name.trim().length >= 2 && country;

  const countries = useMemo(() => countryOptions(), []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || submitting || !activeOrganization?.id) return;

    setSubmitting(true);
    try {
      const payload = {
        organization_id: activeOrganization.id,
        name: name.trim(),
        ...(address.trim() && { address: address.trim() }),
        ...(city.trim() && { city: city.trim() }),
        ...(country && { country }),
        ...(lat !== '' && { latitude: parseFloat(lat) }),
        ...(lng !== '' && { longitude: parseFloat(lng) }),
      };

      const { data, error } = await supabase
        .from('locations')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      if (!data?.id) throw new Error('No se creó la ubicación');

      toast({
        title: 'Ubicación agregada',
        description: `${name.trim()} está listo. Ahora podés configurar el menú y comenzar a tomar pedidos.`,
      });

      // Refresh location list in auth context
      await fetchLocations();

      reset();
      onOpenChange(false);
      if (onSuccess) onSuccess(data);
    } catch (err) {
      const e = err as { message?: string; error?: string } | null;
      const msg = e?.message || e?.error || 'No se pudo crear la ubicación';
      toast({
        title: 'No se pudo agregar la ubicación',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle>Agregá tu primera ubicación</DialogTitle>
          </div>
          <DialogDescription>
            Una ubicación representa una tienda física o punto de atención. Podés agregar más desde Configuración.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Location name */}
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">
              Nombre de la ubicación <span className="text-destructive">*</span>
            </Label>
            <Input
              id="loc-name"
              placeholder="Ej.: Sucursal principal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoFocus
              maxLength={120}
              required
            />
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label htmlFor="loc-address">Dirección</Label>
            <AddressAutocomplete
              id="loc-address"
              placeholder="Comenzá a escribir una dirección…"
              value={address}
              onChange={setAddress}
              onSelect={(s) => {
                setAddress(s.street || s.place_name || address);
                if (s.city) setCity(s.city);
                if (s.lat != null) setLat(String(s.lat));
                if (s.lng != null) setLng(String(s.lng));
              }}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Elegí una sugerencia para ubicar el local automáticamente en el mapa.</p>
          </div>

          {/* City + Country row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="loc-city">Ciudad</Label>
              <Input
                id="loc-city"
                placeholder="Ciudad o localidad"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={submitting}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-country">
                País <span className="text-destructive">*</span>
              </Label>
              <Select
                value={country || undefined}
                onValueChange={setCountry}
                disabled={submitting}
              >
                <SelectTrigger id="loc-country">
                  <SelectValue placeholder="Seleccionar…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!isValid || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Agregando…
                </>
              ) : (
                'Agregar ubicación'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddLocationModal;
