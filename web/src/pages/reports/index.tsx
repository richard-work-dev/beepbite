import { useCallback, useEffect, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { BarChart3, Download, RefreshCw, TrendingUp, ShoppingBag, Wallet, ReceiptText } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useAuth } from '@/context/auth-context';
import { useLocale, useMoney } from '@/context/locale-context';
import analyticsService, { type DailySalesSummaryRow } from '@/services/analytics';

interface DailyTotal {
  date: string;
  orders: number;
  netSalesCents: number;
  grossProfitCents: number;
}

interface OrderTypeTotal {
  type: string;
  orders: number;
  netSalesCents: number;
}

function groupByDate(rows: DailySalesSummaryRow[]): DailyTotal[] {
  const totals = new Map<string, DailyTotal>();
  for (const row of rows) {
    const total = totals.get(row.sale_date) ?? {
      date: row.sale_date,
      orders: 0,
      netSalesCents: 0,
      grossProfitCents: 0,
    };
    total.orders += Number(row.order_count || 0);
    total.netSalesCents += Number(row.net_sales_cents || 0);
    total.grossProfitCents += Number(row.gross_profit_cents || 0);
    totals.set(row.sale_date, total);
  }
  return [...totals.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function groupByOrderType(rows: DailySalesSummaryRow[]): OrderTypeTotal[] {
  const totals = new Map<string, OrderTypeTotal>();
  for (const row of rows) {
    const type = row.order_type || 'sin_tipo';
    const total = totals.get(type) ?? { type, orders: 0, netSalesCents: 0 };
    total.orders += Number(row.order_count || 0);
    total.netSalesCents += Number(row.net_sales_cents || 0);
    totals.set(type, total);
  }
  return [...totals.values()].sort((a, b) => b.netSalesCents - a.netSalesCents);
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function ReportsPage() {
  const { activeLocation } = useAuth();
  const { locale } = useLocale();
  const { format: formatMoney } = useMoney();
  const [period, setPeriod] = useState('7d');
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [rows, setRows] = useState<DailySalesSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeLocation?.id) {
      setRows([]);
      setLoading(false);
      setError('Seleccioná un local para consultar los reportes.');
      return;
    }

    const to = customRange?.to && period === 'custom' ? customRange.to : new Date();
    const from = customRange?.from && period === 'custom'
      ? customRange.from
      : addDays(to, -(period === '1d' ? 0 : period === '30d' ? 29 : period === '90d' ? 89 : 6));

    setLoading(true);
    setError(null);
    try {
      const data = await analyticsService.getDailySalesSummary(
        { from: startOfDay(from), to: startOfDay(to) },
        activeLocation.id,
      );
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los reportes.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeLocation?.id, period, customRange]);

  useEffect(() => { void load(); }, [load]);

  const daily = groupByDate(rows);
  const byType = groupByOrderType(rows);
  const orderCount = rows.reduce((total, row) => total + Number(row.order_count || 0), 0);
  const netSalesCents = rows.reduce((total, row) => total + Number(row.net_sales_cents || 0), 0);
  const grossProfitCents = rows.reduce((total, row) => total + Number(row.gross_profit_cents || 0), 0);
  const averageTicketCents = orderCount > 0 ? Math.round(netSalesCents / orderCount) : 0;

  const handlePeriodChange = (value: string) => {
    setPeriod(value);
    if (value === 'custom' && !customRange?.from) {
      const to = new Date();
      setCustomRange({ from: addDays(to, -6), to });
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const data = [
      ['Fecha', 'Tipo de pedido', 'Pedidos', 'Ventas netas (centavos)', 'Utilidad bruta (centavos)'],
      ...rows.map((row) => [row.sale_date, row.order_type, row.order_count, row.net_sales_cents, row.gross_profit_cents]),
    ].map((line) => line.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${data}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `beepbite-reportes-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        title="Reportes"
        description={activeLocation ? `Ventas y pedidos de ${activeLocation.name}.` : 'Ventas y pedidos del local.'}
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Período del reporte">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Hoy</SelectItem>
                <SelectItem value="7d">Últimos 7 días</SelectItem>
                <SelectItem value="30d">Últimos 30 días</SelectItem>
                <SelectItem value="90d">Últimos 90 días</SelectItem>
                <SelectItem value="custom">Período personalizado</SelectItem>
              </SelectContent>
            </Select>
            {period === 'custom' && (
              <DateRangePicker
                date={customRange}
                setDate={setCustomRange}
                className="w-full sm:w-72"
                placeholder="Elegir fechas"
              />
            )}
            <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} title="Actualizar">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="sr-only">Actualizar</span>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || rows.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>Reintentar</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? [...Array(4)].map((_, index) => <Skeleton key={index} className="h-28" />) : (
          <>
            <StatCard label="Pedidos" value={orderCount.toLocaleString(locale)} icon={ShoppingBag} />
            <StatCard label="Ventas netas" value={formatMoney(netSalesCents)} icon={Wallet} />
            <StatCard label="Utilidad bruta estimada" value={formatMoney(grossProfitCents)} icon={TrendingUp} />
            <StatCard label="Promedio por pedido" value={formatMoney(averageTicketCents)} icon={ReceiptText} />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumen por día</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-3 px-5 pb-5"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
            ) : daily.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No hay ventas en el período seleccionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Fecha</th>
                      <th className="px-4 py-3 text-right font-medium">Pedidos</th>
                      <th className="px-4 py-3 text-right font-medium">Ventas netas</th>
                      <th className="px-5 py-3 text-right font-medium">Utilidad bruta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((day) => (
                      <tr key={day.date} className="border-b last:border-0">
                        <td className="px-5 py-3">{dateLabel(day.date)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{day.orders.toLocaleString(locale)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatMoney(day.netSalesCents)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatMoney(day.grossProfitCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ventas por tipo de pedido</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-3 px-5 pb-5"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
            ) : byType.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No hay datos para comparar.</p>
            ) : (
              <div className="divide-y">
                {byType.map((item) => (
                  <div key={item.type} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.type.replaceAll('_', ' ')}</p>
                      <p className="text-xs text-muted-foreground">{item.orders.toLocaleString(locale)} pedidos</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(item.netSalesCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
