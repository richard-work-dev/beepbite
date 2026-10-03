import { test, expect } from '@playwright/test';

test.setTimeout(60_000);
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await page.screenshot({ path: testInfo.outputPath('fallo.png'), animations: 'disabled' }).catch(() => {});
});

// All API traffic is intercepted. These tests never create real orders/payments.
const products = Array.from({ length: 12 }, (_, index) => ({
  id: `product-${index}`, name: index === 0 ? 'Combo de pollo para compartir con papas y bebidas' : `Producto ${index + 1}`,
  price: '12500', description: 'Preparado en el momento. Incluye una guarnición a elección.',
  category_id: 'combos', is_active: true, is_86ed: false, sort_order: index,
  preparation_time_minutes: 20, remaining_today: 30,
}));
const org = { id: 'test-org', name: 'RikoPollo', slug: 'rikopollo', is_active: true };
const location = { id: 'test-location', organization_id: org.id, name: 'RikoPollo Centro', slug: 'rikopollo', is_active: true, accepts_delivery: true, service_style: 'takeaway', currency_code: 'ARS', locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires' };
const store = { ...location, name: 'RikoPollo', address: 'Av. Las Américas 650, Misiones', description: '', offers_collection: true, offers_delivery: true, offers_dine_in: true, accepting_orders: true, estimated_prep_time_minutes: 30, on_delivery_payment_methods: ['cash', 'eft'], online_payment_available: false, transfer_details: { account_holder: 'RikoPollo', alias: 'riko.pollo' }, tax_rate: 0, categories: [{ id: 'combos', name: 'Pollos y combos', items: products }] };
const sizes = [
  ['teléfono compacto', { width: 320, height: 568 }],
  ['teléfono', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
  ['tablet horizontal', { width: 1024, height: 768 }],
  ['teléfono horizontal', { width: 844, height: 390 }],
  ['laptop', { width: 1366, height: 768 }],
];
const zones = [
  { id: 'centro', location_id: location.id, name: 'Centro', delivery_fee_cents: 150000, min_order_cents: 0, estimated_eta_minutes: 30, is_active: true },
  { id: 'norte', location_id: location.id, name: 'Zona norte', delivery_fee_cents: 300000, min_order_cents: 2000000, estimated_eta_minutes: 45, is_active: true },
];
store.delivery_zones = zones;
store.delivery_zones_required = true;

async function mockApp(page, authenticated = false, onSubmit = () => {}) {
  const errors = [];
  const configuredZones = [...zones];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('bb.cookie-consent', JSON.stringify({ necessary: true, analytics: false, marketing: false })));
  if (authenticated) await page.addInitScript(({ org, location }) => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'test-user', email: 'ux@example.test' } }));
    localStorage.setItem('activeOrganization', JSON.stringify(org));
    localStorage.setItem('activeLocation', JSON.stringify(location));
  }, { org, location });
  await page.route('**/*', async route => {
    const request = route.request();
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
    const path = new URL(request.url()).pathname;
    let data = [];
    if (request.method() === 'POST' && (path.endsWith('/stores/rikopollo/orders') || path.endsWith('/pos/orders'))) {
      const body = request.postDataJSON();
      onSubmit(body);
      const fee = zones.find(zone => zone.id === body.delivery_zone_id)?.delivery_fee_cents || 0;
      const total = body.items.reduce((sum, line) => sum + Number(products.find(product => product.id === line.item_id)?.price || 0) * 100 * line.quantity, 0) + fee;
      data = { order_id: 'new-order', order_number: 'WEB-DELIVERY', total_cents: total, total_minor: total, total: total / 100, currency_code: 'ARS', kds_ticket_ids: [], items: [], payment_method: 'cash', status: 'confirmed' };
    } else if (path.endsWith('/delivery-zones') && request.method() === 'POST') {
      const body = request.postDataJSON();
      onSubmit(body);
      data = { ...body, id: 'new-zone' };
      configuredZones.push(data);
    } else if (path.endsWith('/delivery-zones')) data = configuredZones;
    else if (path.endsWith('/stores/rikopollo')) data = store;
    else if (path.endsWith('/me/preferences')) data = { last_view_pos: 'full', last_view_kds: 'station' };
    else if (path.endsWith('/auth/me')) data = { id: 'test-user', email: 'ux@example.test' };
    else if (path.endsWith('/data/organization_members')) data = [{ organization_id: org.id, profile_id: 'test-user', role: 'owner', capabilities: {} }];
    else if (path.endsWith('/data/organizations')) data = [org];
    else if (path.endsWith('/data/locations')) data = [location];
    else if (path.endsWith('/data/profiles')) data = [{ id: 'test-user', full_name: 'Equipo RikoPollo' }];
    else if (path.endsWith('/data/categories')) data = [{ id: 'combos', name: 'Pollos y combos' }];
    else if (path.endsWith('/data/items')) data = products;
    else if (path.endsWith('/data/daily_sales_summary')) data = [{ sale_date: '2026-10-03', order_type: 'collection', order_count: 8, net_sales_cents: 10000000, gross_profit_cents: 4000000 }];
    else if (path.endsWith('/data/orders')) data = [{ id: 'ready-order', location_id: location.id, order_number: 'WEB-123', customer_name: 'María López', fulfillment_type: 'collection', status: 'ready', payment_status: 'pending', payment_method: 'eft', total_cents: 1250000, created_at: new Date().toISOString() }];
    await route.fulfill({ json: data });
  });
  return errors;
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function withinScreen(page, locator) {
  await expect(locator).toBeVisible();
  const viewport = page.viewportSize();
  // Dialog/sheet visibility begins before their entrance animation ends.
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box ? Math.max(-box.x, -box.y, box.x + box.width - viewport.width, box.y + box.height - viewport.height) : Infinity;
  }).toBeLessThanOrEqual(1);
}

for (const [name, viewport] of sizes) {
  test(`delivery por zona: total y confirmación — ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let submitted;
    const errors = await mockApp(page, false, body => { submitted = body; });
    await page.goto('/store/rikopollo', { waitUntil: 'domcontentloaded' });
    await page.getByText('Delivery', { exact: true }).click();
    await page.getByLabel('Zona de entrega', { exact: true }).selectOption('centro');
    await page.getByRole('button', { name: `Agregar ${products[0].name}`, exact: true }).click();
    if (viewport.width < 1024) await page.getByRole('button', { name: /Ver pedido · 1/ }).click();
    const cart = viewport.width < 1024 ? page.getByRole('dialog') : page.getByRole('complementary', { name: 'Tu pedido' });
    await expect(cart.getByText('Envío · Centro', { exact: true })).toBeVisible();
    await cart.getByRole('link', { name: 'Continuar', exact: true }).click();
    await expect(page.getByLabel('Zona de entrega', { exact: true })).toHaveValue('centro');
    await page.getByLabel('Nombre del cliente').fill('María López');
    await page.getByLabel('Teléfono de contacto').fill('3755123456');
    await page.getByLabel('Dirección de entrega', { exact: true }).fill('Av. Las Américas 650, Centro');
    await page.getByRole('button', { name: /Continuar al pago/ }).filter({ visible: true }).click();
    await page.getByRole('button', { name: /Revisar pedido/ }).filter({ visible: true }).click();
    await expect(page.getByText('Centro', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('delivery.png'), animations: 'disabled' });
    await page.getByRole('button', { name: /Confirmar pedido/ }).filter({ visible: true }).click();
    await expect(page.getByRole('heading', { name: '¡Pedido recibido!' })).toBeVisible();
    expect(submitted).toMatchObject({ fulfillment_type: 'delivery', delivery_zone_id: 'centro', expected_total_cents: 1400000 });
    expect(errors).toEqual([]);
  });
  test(`menú y checkout adaptables — ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = await mockApp(page);
    await page.goto('/store/rikopollo', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Hoy se come rico.' })).toBeVisible();
    for (const product of products.slice(0, 8)) await page.getByRole('button', { name: `Agregar ${product.name}`, exact: true }).click();
    await noHorizontalOverflow(page);
    let cart = page.getByRole('complementary', { name: 'Tu pedido' });
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: /Ver pedido · 8/ }).click();
      cart = page.getByRole('dialog');
    }
    const next = cart.getByRole('link', { name: 'Continuar', exact: true });
    await withinScreen(page, next);
    await page.screenshot({ path: testInfo.outputPath('carrito.png'), animations: 'disabled' });
    await next.click();
    await expect(page.getByRole('heading', { name: '¿Cómo recibís tu pedido?' })).toBeVisible();
    await page.getByLabel('Nombre del cliente').fill('María López');
    await page.getByLabel('Teléfono de contacto').fill('3755123456');
    await page.getByRole('button', { name: /Continuar al pago/ }).filter({ visible: true }).click();
    await expect(page.getByRole('heading', { name: 'Elegí cómo pagar' })).toBeVisible();
    await page.getByRole('button', { name: /Revisar pedido/, exact: false }).filter({ visible: true }).click();
    await expect(page.getByRole('heading', { name: 'Revisá y confirmá' })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('checkout.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
  });

  test(`POS: agregar, editar y revisar sin perder el carrito — ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = await mockApp(page, true);
    await page.goto('/pos/workspace', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Nueva cuenta de mostrador', exact: true }).click();
    const productButton = page.getByRole('button', { name: /^Agregar Combo de pollo/ });
    await productButton.click();
    await productButton.click();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('pos-productos.png'), animations: 'disabled' });
    if (viewport.width < 768) await page.getByRole('button', { name: /Revisar pedido · 2/ }).click();
    const ticket = page.getByRole('complementary', { name: 'Comanda del pedido' });
    if (viewport.height <= 600 && viewport.width >= 768) await ticket.getByRole('button', { name: /Revisar y enviar 2/ }).scrollIntoViewIfNeeded();
    await withinScreen(page, ticket.getByRole('button', { name: /Revisar y enviar 2/ }));
    await ticket.getByRole('button', { name: 'Datos', exact: true }).click();
    await page.getByLabel('Nombre del cliente').fill('María con un apellido extenso para probar la pantalla');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await ticket.getByRole('button', { name: /Revisar y enviar 2/ }).click();
    const review = page.getByRole('alertdialog');
    await expect(review.getByText(products[0].name, { exact: false })).toBeVisible();
    await withinScreen(page, review.getByRole('button', { name: 'Confirmar y enviar' }));
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('pos-revision.png'), animations: 'disabled' });
    await review.getByRole('button', { name: 'Editar datos' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Datos del pedido' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Estados', exact: true }).click();
    await expect(page.getByText('WEB-123', { exact: false })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    if (viewport.width < 768) await page.getByRole('button', { name: /Revisar pedido · 2/ }).click();
    await expect(page.getByRole('button', { name: /Revisar y enviar 2/ })).toBeEnabled();
    if (viewport.height <= 600) await page.getByRole('button', { name: /Revisar y enviar 2/ }).scrollIntoViewIfNeeded();
    expect(errors).toEqual([]);
  });

  test(`reportes, búsqueda de módulos y configuración — ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = await mockApp(page, true);
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible();
    await expect(page.getByText('Resumen por día')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('reportes.png'), animations: 'disabled' });
    await page.getByRole('button', { name: viewport.width < 1024 ? 'Más' : 'Módulos', exact: true }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('¿A dónde querés ir?').fill('inventario');
    await expect(drawer.getByRole('link', { name: /Insumos/ })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /Reservas/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await page.goto('/settings/online-ordering', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    if (viewport.width < 1024) await page.getByLabel('¿Qué querés configurar?').selectOption('/settings/organization');
    else await page.getByRole('navigation', { name: 'Navegación de configuración' }).getByRole('link', { name: 'Organización', exact: true }).click();
    await expect(page).toHaveURL(/settings\/organization$/);
    await noHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('configurar precio de zona en pesos sin mapa', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submitted;
  const errors = await mockApp(page, true, body => { submitted = body; });
  await page.goto('/settings/delivery-zones', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nueva zona', exact: true }).first().click();
  await page.getByLabel('Nombre de la zona *', { exact: true }).fill('Barrio sur');
  await page.getByLabel('Costo de envío (ARS)', { exact: true }).fill('2500');
  await page.getByLabel('Pedido mínimo (ARS)', { exact: true }).fill('10000');
  await page.getByRole('button', { name: 'Crear zona', exact: true }).click();
  await expect(page.getByText('Barrio sur', { exact: true })).toBeVisible();
  expect(submitted).toMatchObject({ name: 'Barrio sur', delivery_fee_cents: 250000, min_order_cents: 1000000, polygon: null });
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('POS delivery suma tarifa antes de enviar a cocina', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submitted;
  const errors = await mockApp(page, true, body => { submitted = body; });
  await page.goto('/pos/workspace', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Iniciar pedido de delivery', exact: true }).click();
  await page.getByLabel('Zona de entrega', { exact: true }).selectOption('centro');
  await page.getByLabel('Dirección de entrega', { exact: true }).fill('Av. Las Américas 650, Centro');
  await page.getByLabel('Nombre del cliente').fill('María López');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('button', { name: /^Agregar Combo de pollo/ }).click();
  await page.getByRole('button', { name: /Revisar pedido · 1/ }).click();
  await expect(page.getByText('Envío · Centro', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Revisar y enviar 1/ }).click();
  const review = page.getByRole('alertdialog');
  await expect(review.getByText('Av. Las Américas 650, Centro', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Confirmar y enviar', exact: true }).click();
  await expect(page.getByText(/Pedido n.º WEB-DELIVERY enviado a cocina/)).toBeVisible();
  expect(submitted).toMatchObject({ order_type: 'delivery', delivery_zone_id: 'centro', expected_delivery_fee_cents: 150000, delivery_address: 'Av. Las Américas 650, Centro' });
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
