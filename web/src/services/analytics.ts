import { api } from '../lib/api-client';
import { addDays, format, startOfDay, subDays, eachDayOfInterval } from 'date-fns';

export interface DailySalesSummaryRow {
  location_id: string;
  sale_date: string;
  order_type: string;
  order_count: number;
  gross_subtotal_cents: number;
  tax_total_cents: number;
  discount_total_cents: number;
  tip_total_cents: number;
  delivery_fee_total_cents: number;
  net_sales_cents: number;
  gross_profit_cents: number;
  gross_profit_available?: boolean;
  [key: string]: unknown;
}

export interface HourlySalesHeatmapRow {
  location_id: string;
  hour_of_day: number;
  order_count: number;
  total_revenue_cents: number;
  [key: string]: unknown;
}

interface ReportOrder {
  id?: string;
  business_date?: string;
  created_at?: string;
  order_type?: string;
  status?: string;
  payment_status?: string;
  subtotal_cents?: number | string;
  discount_cents?: number | string;
  total_cents?: number | string;
  customer_id?: string;
  customer_name?: string;
  order_number?: string;
  completed_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

interface ReportTicket {
  order_id?: string;
  fired_at?: string;
  ready_at?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AnalyticsData {
  averageResponseTime: { minutes: number; seconds: number; trend: string; trendDirection: string };
  totalOrders: { count: number; trend: string; trendDirection: string };
  averageRating: { rating: number; trend: string; trendDirection: string };
  completionRate: { percentage: number; trend: string; trendDirection: string };
  recentOrders: unknown[];
  performanceByHour: Array<{ hour: string; orders: number; avgTimeMinutes: number; avgTime: string; responseTime: number }>;
  responseTimeTrend: Array<{ date: string; avgResponse: number; orders: number }>;
  orderStatusDistribution: unknown[];
  weeklyOrderVolume: Array<{ day: string; orders: number; revenue: number }>;
  customerAnalytics: {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    avgOrdersPerCustomer: number;
    retentionRate: number;
  };
}

/**
 * Analytics service — reads optional reporting aggregates through the data
 * layer and derives the core sales metrics from tenant-scoped order records
 * when those aggregates are absent (the serverless/DynamoDB deployment).
 * The aggregate table names remain for compatibility with deployments that
 * materialize them; they are not required for the reports page to work.
 */
class AnalyticsService {
  private _locationId: string | null;

  constructor() {
    this._locationId = null;
  }

  // ------------------------------------------------------------------
  // Location resolution
  // ------------------------------------------------------------------

  /**
   * Return the active location_id.  Reads from localStorage where auth-context
   * persists the active location, then falls back to the first location the
   * API returns for the authenticated user.
   */
  async getLocationId(): Promise<string | null> {
    if (this._locationId) return this._locationId;

    // 1. Try the value written by auth-context.
    try {
      const stored = localStorage.getItem('activeLocation');
      if (stored) {
        const location: unknown = JSON.parse(stored);
        if (
          typeof location === 'object' &&
          location !== null &&
          'id' in location &&
          typeof location.id === 'string'
        ) {
          this._locationId = location.id;
          return this._locationId;
        }
      }
    } catch (_) { /* ignore parse errors */ }

    // 2. Fall back: fetch the first location accessible to this user.
    const { data, error } = await api.request<{ id: string }[]>('GET', '/data/locations?limit=1');
    if (!error && Array.isArray(data) && data.length > 0) {
      this._locationId = data[0].id;
      return this._locationId;
    }

    return null;
  }

  /** Allow callers (e.g. auth-context) to push the active location in. */
  setLocationId(locationId: string | null) {
    this._locationId = locationId;
  }

  // ------------------------------------------------------------------
  // Public entry points
  // ------------------------------------------------------------------

  /**
   * Main entry: mirrors the old getAnalyticsData(timeRangeOrDates) signature.
   */
  async getAnalyticsData(timeRangeOrDates: string | { from: Date; to: Date } = '7d'): Promise<AnalyticsData> {
    try {
      const locationId = await this.getLocationId();
      if (!locationId) throw new Error('No location found for user');

      if (typeof timeRangeOrDates === 'object' && timeRangeOrDates.from && timeRangeOrDates.to) {
        return await this._fetchByDateRange(locationId, timeRangeOrDates);
      }
      return await this._fetchByPeriod(locationId, timeRangeOrDates as string);
    } catch (error) {
      console.error('Error fetching analytics data:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  // ------------------------------------------------------------------
  // Internal fetch helpers
  // ------------------------------------------------------------------

  /** Convert a period string like '7d' to a {from, to} date range. */
  _periodToRange(period: string): { from: Date; to: Date } {
    const to = new Date();
    let days = 7;
    if (period === '1d')  days = 1;
    else if (period === '30d') days = 30;
    else if (period === '90d') days = 90;
    return { from: subDays(to, days - 1), to };
  }

  async _fetchByPeriod(locationId: string, period: string): Promise<AnalyticsData> {
    return this._fetchByDateRange(locationId, this._periodToRange(period));
  }

  async _fetchByDateRange(locationId: string, { from, to }: { from: Date; to: Date }): Promise<AnalyticsData> {
    const dailyRows = await this.getDailySalesSummary({ from, to }, locationId);
    const startDate = format(from, 'yyyy-MM-dd');
    const endDate = format(to, 'yyyy-MM-dd');
    const common = `eq=location_id,${encodeURIComponent(locationId)}`;
    const start = startOfDay(from);
    const endExclusive = addDays(startOfDay(to), 1);
    const [ordersRes, legacyOrdersRes, ticketsRes, customersRes, reviewsRes, hourlyRes] = await Promise.all([
      api.request<ReportOrder[]>('GET', `/data/orders?${common}&gte=business_date,${startDate}&lte=business_date,${endDate}&order=created_at.desc`),
      api.request<ReportOrder[]>('GET', `/data/orders?${common}&gte=created_at,${encodeURIComponent(addDays(start, -1).toISOString())}&lt=created_at,${encodeURIComponent(addDays(endExclusive, 1).toISOString())}`),
      // Tickets inherit tenant scope from the authenticated data endpoint, but
      // do not carry location_id themselves; location is resolved through the
      // corresponding scoped order below.
      api.request<ReportTicket[]>('GET', '/data/kds_tickets?limit=1000'),
      api.request<Array<{ id?: string; created_at?: string; first_order_at?: string }>>('GET', `/data/customers?${common}`),
      api.request<Array<{ rating?: number | string; created_at?: string }>>('GET', `/data/reviews?${common}&gte=created_at,${encodeURIComponent(startOfDay(from).toISOString())}&lte=created_at,${encodeURIComponent(addDays(startOfDay(to), 1).toISOString())}`),
      api.request<HourlySalesHeatmapRow[]>('GET', `/data/hourly_sales_heatmap?${common}`),
    ]);
    if (ordersRes.error && legacyOrdersRes.error) throw new Error(ordersRes.error.message || legacyOrdersRes.error.message || 'No se pudieron cargar los pedidos del reporte.');
    const byID = new Map<string, ReportOrder>();
    for (const order of [...(ordersRes.data || []), ...(legacyOrdersRes.data || [])]) {
      byID.set(order.id || `${order.created_at}:${order.order_type}`, order);
    }
    const reportOrders = [...byID.values()].filter(order => {
      if (order.business_date) return order.business_date >= startDate && order.business_date <= endDate;
      if (!order.created_at) return false;
      const at = new Date(order.created_at);
      return Number.isFinite(+at) && at >= addDays(start, -1) && at < addDays(endExclusive, 1);
    });
    return this._transform(
      dailyRows,
      hourlyRes.error ? [] : hourlyRes.data || [],
      { from, to },
      reportOrders,
      ticketsRes.error ? [] : ticketsRes.data || [],
      customersRes.error ? [] : customersRes.data || [],
      reviewsRes.error ? [] : reviewsRes.data || [],
    );
  }

  // ------------------------------------------------------------------
  // Data transformation — produces the same shape the UI expects
  // ------------------------------------------------------------------

  _transform(
    dailyRows: DailySalesSummaryRow[],
    hourlyRows: HourlySalesHeatmapRow[],
    { from, to }: { from: Date; to: Date },
    orders: ReportOrder[] = [],
    tickets: ReportTicket[] = [],
    customers: Array<{ id?: string; created_at?: string; first_order_at?: string }> = [],
    reviews: Array<{ rating?: number | string }> = [],
  ): AnalyticsData {
    // ---- summary metrics from daily_sales_summary ----
    const reportedOrderCount = dailyRows.reduce((s, r) => s + Number(r.order_count || 0), 0);
    const totalOrders = reportedOrderCount || orders.filter(order => order.status !== 'cancelled').length;
    // Use net_sales as a proxy for "revenue"; avg ticket approximated.

    // ---- responseTimeTrend: one entry per day in the range ----
    const days = eachDayOfInterval({ start: from, end: to });
    const dailyByDate = new Map<string, { orders: number; net: number }>();
    for (const r of dailyRows) {
      const key = r.sale_date;
      const cur = dailyByDate.get(key) || { orders: 0, net: 0 };
      cur.orders += Number(r.order_count || 0);
      cur.net    += Number(r.net_sales_cents || 0);
      dailyByDate.set(key, cur);
    }

    const responseTimeTrend = days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const row = dailyByDate.get(key) || { orders: 0, net: 0 };
      return {
        date: format(d, 'MMM d'),
        avgResponse: 0,
        orders: row.orders,
      };
    });

    // ---- weeklyOrderVolume: same daily rows, labelled as the date ----
    const weeklyOrderVolume = days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const row = dailyByDate.get(key) || { orders: 0, net: 0 };
      return {
        day:     format(d, 'MMM d'),
        orders:  row.orders,
        revenue: row.net,
      };
    });

    // ---- performanceByHour from hourly_sales_heatmap ----
    // Aggregate across all days_of_week — view is trailing 90d, not date-filtered.
    const hourMap = new Map<number, { orders: number; revenue: number }>(); // hour_of_day -> { orders, revenue }
    for (const r of hourlyRows) {
      const h = Number(r.hour_of_day);
      const cur = hourMap.get(h) || { orders: 0, revenue: 0 };
      cur.orders  += Number(r.order_count   || 0);
      cur.revenue += Number(r.total_revenue_cents || 0);
      hourMap.set(h, cur);
    }
    // The pre-aggregated heatmap is optional on a new tenant. Derive a useful
    // location- and date-scoped chart from the primary orders when it is empty.
    if (hourMap.size === 0) {
      for (const order of orders) {
        if (!order.created_at) continue;
        const createdAt = new Date(order.created_at);
        if (!Number.isFinite(+createdAt) || createdAt < startOfDay(from) || createdAt >= addDays(startOfDay(to), 1)) continue;
        const hour = createdAt.getHours();
        const cur = hourMap.get(hour) || { orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += Number(order.total_cents || 0);
        hourMap.set(hour, cur);
      }
    }
    const responseByHour = new Map<number, { seconds: number; count: number }>();
    const responseByDate = new Map<string, { seconds: number; count: number }>();
    const responseByOrder = new Map<string, number>();
    const reportOrderIds = new Set(orders.map(order => order.id).filter((id): id is string => Boolean(id)));
    for (const ticket of tickets) {
      if (!ticket.order_id || !reportOrderIds.has(ticket.order_id)) continue;
      const firedAt = ticket.fired_at ? new Date(ticket.fired_at) : null;
      const readyAt = ticket.ready_at ? new Date(ticket.ready_at) : null;
      if (!firedAt || !readyAt || !Number.isFinite(+firedAt) || !Number.isFinite(+readyAt) || +readyAt < +firedAt) continue;
      const seconds = (+readyAt - +firedAt) / 1000;
      const hour = firedAt.getHours();
      const hourMetric = responseByHour.get(hour) || { seconds: 0, count: 0 };
      hourMetric.seconds += seconds;
      hourMetric.count += 1;
      responseByHour.set(hour, hourMetric);
      const date = format(firedAt, 'yyyy-MM-dd');
      const dayMetric = responseByDate.get(date) || { seconds: 0, count: 0 };
      dayMetric.seconds += seconds;
      dayMetric.count += 1;
      responseByDate.set(date, dayMetric);
      responseByOrder.set(ticket.order_id, seconds);
    }
    const performanceByHour = Array.from({ length: 24 }, (_, h) => {
      const cur = hourMap.get(h) || { orders: 0, revenue: 0 };
      const response = responseByHour.get(h);
      const avgTimeMinutes = response?.count ? response.seconds / response.count / 60 : 0;
      const hourLabel = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      return {
        hour:           hourLabel,
        orders:         cur.orders,
        avgTimeMinutes,
        avgTime:        `${Math.floor(avgTimeMinutes)}m ${Math.round(avgTimeMinutes % 1 * 60)}s`,
        responseTime:   avgTimeMinutes * 60,
      };
    }).filter(r => r.orders > 0);

    const statusCounts = new Map<string, number>();
    for (const order of orders) {
      const status = order.status || 'desconocido';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    }
    const statusLabels: Record<string, string> = { completed: 'Completado', delivered: 'Entregado', confirmed: 'Confirmado', preparing: 'En preparación', ready: 'Listo', cancelled: 'Cancelado', pending: 'Pendiente', pending_on_delivery: 'Pendiente de cobro' };
    const orderStatusDistribution: unknown[] = [...statusCounts].map(([status, count]) => ({ name: statusLabels[status] || status, status, value: count, count }));
    const recentOrders: unknown[] = [...orders]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 10)
      .map(order => ({ ...order, responseTimeSeconds: order.id ? responseByOrder.get(order.id) ?? null : null }));
    const ratings = reviews.map(review => Number(review.rating)).filter(rating => Number.isFinite(rating) && rating > 0);
    const averageRating = { rating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0, trend: '—', trendDirection: 'up' };
    const completeCount = orders.filter(order => ['completed', 'delivered'].includes(order.status || '')).length;
    const completionRate = { percentage: orders.length ? completeCount / orders.length * 100 : 0, trend: '—', trendDirection: 'up' };
    const responseTotal = [...responseByDate.values()].reduce((sum, row) => sum + row.seconds, 0);
    const responseCount = [...responseByDate.values()].reduce((sum, row) => sum + row.count, 0);
    const averageResponseSeconds = responseCount ? responseTotal / responseCount : 0;
    for (const trend of responseTimeTrend) {
      const date = days.find(day => format(day, 'MMM d') === trend.date);
      const metric = date ? responseByDate.get(format(date, 'yyyy-MM-dd')) : undefined;
      trend.avgResponse = metric?.count ? metric.seconds / metric.count : 0;
    }
    const customersWithOrders = new Set(orders.map(order => order.customer_id).filter((id): id is string => Boolean(id)));
    const newCustomerCutoff = startOfDay(from).getTime();
    const newCustomers = customers.filter(customer => {
      const created = customer.first_order_at || customer.created_at;
      return created ? new Date(created).getTime() >= newCustomerCutoff && new Date(created).getTime() <= to.getTime() : false;
    }).length;
    const returningCustomers = [...customersWithOrders].filter(id => orders.filter(order => order.customer_id === id).length > 1).length;

    return {
      averageResponseTime: {
        minutes:        Math.floor(averageResponseSeconds / 60),
        seconds:        Math.round(averageResponseSeconds % 60),
        trend:          responseCount ? 'Período seleccionado' : 'Sin datos de cocina',
        trendDirection: 'up',
      },
      totalOrders: {
        count:          totalOrders,
        trend:          'N/A',
        trendDirection: 'up',
      },
      averageRating,
      completionRate,
      recentOrders,
      performanceByHour,
      responseTimeTrend,
      orderStatusDistribution,
      weeklyOrderVolume,
      customerAnalytics: {
        totalCustomers:        customers.length,
        newCustomers,
        returningCustomers,
        avgOrdersPerCustomer:  customersWithOrders.size ? orders.length / customersWithOrders.size : 0,
        retentionRate:         customersWithOrders.size ? returningCustomers / customersWithOrders.size * 100 : 0,
      },
    };
  }

  // ------------------------------------------------------------------
  // Individual named fetchers kept for any direct callers
  // ------------------------------------------------------------------

  async getDailySalesSummary(
    { from, to }: { from: Date; to: Date },
    locationId?: string,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  ): Promise<DailySalesSummaryRow[]> {
    const resolvedLocationId = locationId || await this.getLocationId();
    if (!resolvedLocationId) throw new Error('No se encontró un local para consultar los reportes.');
    const startDate = format(from, 'yyyy-MM-dd');
    const endDate = format(to, 'yyyy-MM-dd');
    const { data, error } = await api.request<DailySalesSummaryRow[]>(
      'GET',
      `/data/daily_sales_summary?eq=location_id,${encodeURIComponent(resolvedLocationId)}&gte=sale_date,${startDate}&lte=sale_date,${endDate}&order=sale_date.asc`,
    );
    if (!error && data && data.length > 0) return data;

    // Some installations have the reporting views disabled or not refreshed
    // yet. Keep the report useful by falling back to the transactional orders
    // table, which is already available to the POS and uses the same location
    // scope. This also makes newly-created sales visible immediately.
    const ordersQuery = [
      `eq=location_id,${encodeURIComponent(resolvedLocationId)}`,
      `gte=business_date,${startDate}`,
      `lte=business_date,${endDate}`,
      'neq=status,cancelled',
      'select=id,business_date,created_at,order_type,status,payment_status,subtotal_cents,discount_cents,total_cents',
      'order=business_date.asc',
      // The serverless data API reads the tenant partition before applying
      // filters and caps explicit limits at 1000. Omitting limit lets the API
      // apply its own safe maximum.
    ].join('&');
    const businessDateOrders = await api.request<ReportOrder[]>('GET', `/data/orders?${ordersQuery}`);
    const start = startOfDay(from);
    const endExclusive = addDays(startOfDay(to), 2);
    const createdAtQuery = [
      `eq=location_id,${encodeURIComponent(resolvedLocationId)}`,
      `gte=created_at,${encodeURIComponent(addDays(start, -1).toISOString())}`,
      `lt=created_at,${encodeURIComponent(endExclusive.toISOString())}`,
      'neq=status,cancelled',
      'select=id,business_date,created_at,order_type,status,payment_status,subtotal_cents,discount_cents,total_cents',
    ].join('&');
    const createdAtOrders = await api.request<ReportOrder[]>(
      'GET', `/data/orders?${createdAtQuery}`,
    );
    if (businessDateOrders.error && createdAtOrders.error) {
      throw new Error(error?.message || businessDateOrders.error.message || createdAtOrders.error.message);
    }

    const grouped = new Map<string, DailySalesSummaryRow>();
    const orders = new Map<string, ReportOrder>();
    for (const order of [...(businessDateOrders.data || []), ...(createdAtOrders.data || [])]) {
      orders.set(order.id || `${order.created_at || order.business_date}:${order.order_type}`, order);
    }
    const localDate = (timestamp: string): string => {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(new Date(timestamp));
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
      } catch {
        return timestamp.slice(0, 10);
      }
    };
    const rangeStartDate = format(start, 'yyyy-MM-dd');
    const rangeEndDate = format(startOfDay(to), 'yyyy-MM-dd');
    for (const order of orders.values()) {
      const hasLifecycle = Boolean(order.status || order.payment_status);
      const recognizedSale = ['completed', 'delivered', 'paid'].includes(order.status || '') || ['paid', 'completed'].includes(order.payment_status || '');
      if (hasLifecycle && !recognizedSale) continue;
      const date = order.business_date || (order.created_at ? localDate(order.created_at) : '');
      if (!date || date < rangeStartDate || date > rangeEndDate) continue;
      const orderType = order.order_type || 'sin_tipo';
      const key = `${date}:${orderType}`;
      const row = grouped.get(key) || {
        location_id: resolvedLocationId,
        sale_date: date,
        order_type: orderType,
        order_count: 0,
        gross_subtotal_cents: 0,
        tax_total_cents: 0,
        discount_total_cents: 0,
        tip_total_cents: 0,
        delivery_fee_total_cents: 0,
        net_sales_cents: 0,
        gross_profit_cents: 0,
        gross_profit_available: false,
      };
      const subtotal = Number(order.subtotal_cents || 0);
      const discount = Number(order.discount_cents || 0);
      row.order_count += 1;
      row.gross_subtotal_cents += subtotal;
      row.discount_total_cents += discount;
      row.net_sales_cents += subtotal - discount;
      grouped.set(key, row);
    }
    return [...grouped.values()].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
  }

  async getAnalyticsSummary(timeRange = '7d'): Promise<DailySalesSummaryRow[]> {
    const locationId = await this.getLocationId();
    if (!locationId) throw new Error('No location found for user');
    const { from, to } = this._periodToRange(timeRange);
    return this.getDailySalesSummary({ from, to }, locationId);
  }

  async getOrdersByHour(): Promise<HourlySalesHeatmapRow[]> {
    const locationId = await this.getLocationId();
    if (!locationId) throw new Error('No location found for user');
    const { data, error } = await api.request<HourlySalesHeatmapRow[]>(
      'GET',
      `/data/hourly_sales_heatmap?eq=location_id,${locationId}`
    );
    if (error) throw new Error(error.message);
    return data || [];
  }

  async getDailyTrends(timeRange = '7d'): Promise<DailySalesSummaryRow[]> {
    const locationId = await this.getLocationId();
    if (!locationId) throw new Error('No location found for user');
    const { from, to } = this._periodToRange(timeRange);
    return this.getDailySalesSummary({ from, to }, locationId);
  }

  async getOrderStatusDistribution(timeRange = '7d'): Promise<unknown[]> {
    return (await this.getAnalyticsData(timeRange)).orderStatusDistribution;
  }

  async getRecentOrdersWithResponseTimes(limit = 10): Promise<unknown[]> {
    return (await this.getAnalyticsData('30d')).recentOrders.slice(0, limit);
  }

  async getCustomerAnalytics(timeRange = '30d'): Promise<Record<string, unknown>> {
    return (await this.getAnalyticsData(timeRange)).customerAnalytics;
  }
}

// Singleton instance
const analyticsService = new AnalyticsService();
export default analyticsService;
