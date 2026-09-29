import { Loader2, Play, Wifi, WifiOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

/**
 * Online / offline shift toggle.
 *
 * Props:
 *   isOnline   {boolean}  — current shift state
 *   loading    {boolean}  — API call in-flight
 *   onChange   {(bool) => void}
 */
interface ShiftToggleProps {
  isOnline: boolean;
  isPaused: boolean;
  loading: boolean;
  onChange: (isOnline: boolean) => void;
}

export default function ShiftToggle({ isOnline, isPaused, loading, onChange }: ShiftToggleProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 border transition-colors ${
        isOnline
          ? 'bg-success/10 border-success/25'
          : isPaused
          ? 'bg-warning/10 border-warning/30'
          : 'bg-muted border-border'
      }`}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      ) : isOnline ? (
        <Wifi className="w-5 h-5 text-success" />
      ) : isPaused ? (
        <WifiOff className="w-5 h-5 text-warning" />
      ) : (
        <WifiOff className="w-5 h-5 text-muted-foreground" />
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isOnline ? 'text-success' : 'text-foreground'}`}>
          {isOnline ? 'En línea — recibiendo entregas' : isPaused ? 'Turno en pausa' : 'Fuera de turno'}
        </p>
        <p className="text-xs text-muted-foreground/80 leading-tight">
          {isOnline
            ? 'Tu ubicación se comparte durante una entrega activa.'
            : isPaused
            ? 'No recibirás nuevas entregas hasta reanudar el turno.'
            : 'Iniciá el turno para recibir entregas.'}
        </p>
      </div>

      {isPaused && (
        <Button size="sm" variant="outline" onClick={() => onChange(true)} disabled={loading}>
          <Play className="mr-1.5 h-4 w-4" />
          Reanudar
        </Button>
      )}

      <Switch
        checked={isOnline || isPaused}
        onCheckedChange={onChange}
        disabled={loading}
        className="data-[state=checked]:bg-success"
      />
    </div>
  );
}
