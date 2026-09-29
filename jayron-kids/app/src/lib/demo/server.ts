/**
 * Демо-магазин внутри приложения (EXPO_PUBLIC_DEMO=1): отвечает на те же запросы,
 * что и сервер, но без сети. Каталог — снимок настоящего сервера (catalog.json,
 * обновляется скриптом scripts/demo-snapshot.js); корзина, вход, заказы и остатки
 * хранятся только на этом устройстве. Онлайн-оплата подтверждается сразу.
 */
import { loadJson, saveJson } from '../storage';
import { ApiError } from '../errors';
import type {
  Category, Customer, DeliveryMethod, Order, PaymentMethod, Product, ProductDetails, Quote, QuoteProblem, Region, ShopConfig,
} from '../types';
import snapshot from './catalog.json';

type PromoCode = { code: string; kind: 'percent' | 'fixed'; value: number; minTotal: number };
type Catalog = {
  config: ShopConfig;
  categories: Category[];
  regions: Region[];
  products: ProductDetails[];
  promoCodes: PromoCode[];
};

type DemoOrder = Order & { owner: string };
type State = {
  stock: Record<string, number>;
  customers: Record<string, Customer>;
  orders: DemoOrder[];
  nextOrderId: number;
  pendingCode: { phone: string; code: string; attempts: number } | null;
};

const catalog = snapshot as unknown as Catalog;
const STORAGE_KEY = 'jayron.demo';
const MAX_QUANTITY = 20;

const variants = new Map(catalog.products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }] as const)));
const categorySlug = new Map(catalog.categories.map((c) => [c.id, c]));

let state: State | null = null;

async function load(): Promise<State> {
  if (state) return state;
  const saved = await loadJson<State | null>(STORAGE_KEY, null);
  state = saved && typeof saved === 'object' && Array.isArray(saved.orders)
    ? saved
    : { stock: {}, customers: {}, orders: [], nextOrderId: 1001, pendingCode: null };
  return state;
}

const persist = () => saveJson(STORAGE_KEY, state);

const stockOf = (s: State, variantId: number) => s.stock[variantId] ?? variants.get(variantId)?.variant.stock ?? 0;

// ------------------------------------------------------------------ телефоны
function normalizePhone(input: unknown): string | null {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 9) digits = `998${digits}`;
  return /^998\d{9}$/.test(digits) ? digits : null;
}

const formatPhone = (p: string) => `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10, 12)}`;

// ------------------------------------------------------------------ каталог
const bySize = (a: string, b: string) => Number(a) - Number(b);

function summary(s: State, p: ProductDetails): Product {
  const stocked = p.variants.map((v) => ({ ...v, stock: stockOf(s, v.id) }));
  return {
    id: p.id,
    slug: p.slug,
    categoryId: p.categoryId,
    categorySlug: p.categorySlug,
    name: p.name,
    kind: p.kind,
    gender: p.gender,
    price: p.price,
    oldPrice: p.oldPrice,
    images: p.images,
    isNew: p.isNew,
    isHit: p.isHit,
    colors: p.colors,
    sizes: [...new Set(stocked.map((v) => v.size))].sort(bySize),
    inStock: stocked.some((v) => v.stock > 0),
  };
}

function details(s: State, p: ProductDetails): ProductDetails {
  return { ...p, ...summary(s, p), variants: p.variants.map((v) => ({ ...v, stock: stockOf(s, v.id) })) };
}

function listProducts(s: State, q: URLSearchParams) {
  let items = catalog.products.slice();
  const category = q.get('category');
  if (category) items = items.filter((p) => p.categorySlug === category);
  const gender = q.get('gender');
  if (gender === 'boy' || gender === 'girl') items = items.filter((p) => p.gender === gender || p.gender === 'unisex');
  if (q.get('new') === '1') items = items.filter((p) => p.isNew);
  if (q.get('hit') === '1') items = items.filter((p) => p.isHit);
  if (q.get('sale') === '1') items = items.filter((p) => p.oldPrice !== null);
  const size = q.get('size');
  if (size) items = items.filter((p) => p.variants.some((v) => v.size === size && stockOf(s, v.id) > 0));
  const term = (q.get('q') ?? '').trim().toLowerCase();
  if (term) {
    items = items.filter((p) => {
      const c = categorySlug.get(p.categoryId);
      return [p.name.uz, p.name.ru, c?.name.uz, c?.name.ru].some((text) => text?.toLowerCase().includes(term));
    });
  }
  const ids = q.get('ids');
  if (ids !== null) {
    const wanted = new Set(ids.split(',').map(Number));
    items = items.filter((p) => wanted.has(p.id));
  }

  const sorters: Record<string, (a: ProductDetails, b: ProductDetails) => number> = {
    popular: (a, b) => Number(b.isHit) - Number(a.isHit) || a.id - b.id,
    new: (a, b) => Number(b.isNew) - Number(a.isNew) || b.id - a.id,
    price_asc: (a, b) => a.price - b.price || a.id - b.id,
    price_desc: (a, b) => b.price - a.price || a.id - b.id,
  };
  items.sort(sorters[q.get('sort') ?? ''] ?? sorters.popular);

  const limit = Math.min(Math.max(Number(q.get('limit')) || 40, 1), 100);
  const offset = Math.max(Number(q.get('offset')) || 0, 0);
  return { items: items.slice(offset, offset + limit).map((p) => summary(s, p)), total: items.length };
}

// ------------------------------------------------------------------ корзина
type QuoteInput = { items?: unknown; deliveryMethod?: string; regionCode?: string | null; promoCode?: string };

function buildQuote(s: State, input: QuoteInput) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ApiError('cart_empty', 400);
  const merged = new Map<number, number>();
  for (const raw of input.items as { variantId?: unknown; quantity?: unknown }[]) {
    const variantId = Number(raw?.variantId);
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(variantId) || variantId <= 0) throw new ApiError('invalid_item', 400);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError('invalid_quantity', 400);
    merged.set(variantId, Math.min((merged.get(variantId) ?? 0) + quantity, MAX_QUANTITY));
  }

  const deliveryMethod: DeliveryMethod = ['courier', 'post', 'pickup'].includes(String(input.deliveryMethod))
    ? input.deliveryMethod as DeliveryMethod
    : 'courier';
  const problems: QuoteProblem[] = [];
  const lines: Quote['lines'] = [];
  let subtotal = 0;

  for (const [variantId, quantity] of merged) {
    const found = variants.get(variantId);
    if (!found) {
      problems.push({ code: 'unavailable', variantId });
      continue;
    }
    const { product, variant } = found;
    const available = stockOf(s, variantId);
    if (available < quantity) problems.push({ code: 'out_of_stock', variantId, available });
    const color = product.colors.find((c) => c.code === variant.colorCode)!;
    subtotal += product.price * quantity;
    lines.push({
      variantId,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      kind: product.kind,
      size: variant.size,
      color: { hex: color.hex, name: color.name },
      image: product.images[0] ?? null,
      price: product.price,
      quantity,
      available,
      lineTotal: product.price * quantity,
    });
  }

  const { freeDeliveryFrom, minOrderTotal } = catalog.config;
  if (subtotal < minOrderTotal) problems.push({ code: 'min_order', minTotal: minOrderTotal });

  let discount = 0;
  const promo: Quote['promo'] = { code: '', applied: false, error: null, minTotal: null };
  if (input.promoCode) {
    promo.code = String(input.promoCode).trim().toUpperCase();
    const found = catalog.promoCodes.find((p) => p.code === promo.code);
    if (!found) {
      promo.error = 'promo_not_found';
    } else if (subtotal < found.minTotal) {
      promo.error = 'promo_min_total';
      promo.minTotal = found.minTotal;
    } else {
      discount = found.kind === 'percent' ? Math.floor((subtotal * found.value) / 100) : Math.min(found.value, subtotal);
      promo.applied = true;
    }
  }

  let delivery = 0;
  let region: Region | undefined;
  if (deliveryMethod !== 'pickup') {
    region = catalog.regions.find((r) => r.code === input.regionCode);
    if (!region) {
      problems.push({ code: 'region_required' });
    } else if (deliveryMethod === 'courier' && region.courierPrice === null) {
      problems.push({ code: 'courier_unavailable' });
    } else {
      delivery = deliveryMethod === 'courier' ? region.courierPrice ?? 0 : region.postPrice;
    }
    if (subtotal - discount >= freeDeliveryFrom) delivery = 0;
  }

  const quote: Quote = {
    lines,
    subtotal,
    discount,
    delivery,
    total: subtotal - discount + delivery,
    deliveryMethod,
    regionCode: region?.code ?? null,
    promo,
    problems,
    freeDeliveryFrom,
    minOrderTotal,
  };
  return quote;
}

// ------------------------------------------------------------------ покупатель и заказы
function requireCustomer(s: State, token: string | null): Customer {
  const phone = token?.startsWith('demo.') ? token.slice(5) : null;
  const customer = phone ? s.customers[phone] : undefined;
  if (!customer) throw new ApiError('unauthorized', 401);
  return customer;
}

function publicOrder({ owner, ...order }: DemoOrder): Order {
  return { ...order, canCancel: order.status === 'new' && order.paymentStatus !== 'paid' };
}

function findOrder(s: State, customer: Customer, id: string): DemoOrder {
  const order = s.orders.find((o) => o.id === Number(id) && o.owner === customer.phone);
  if (!order) throw new ApiError('order_not_found', 404);
  return order;
}

type CheckoutBody = QuoteInput & {
  recipientName?: string; recipientPhone?: string; paymentMethod?: string;
  city?: string; address?: string; comment?: string; language?: string;
};

function createOrder(s: State, customer: Customer, body: CheckoutBody): Order {
  const recipientName = String(body.recipientName ?? '').trim().slice(0, 100);
  if (recipientName.length < 2) throw new ApiError('invalid_name', 400);
  const recipientPhone = normalizePhone(body.recipientPhone);
  if (!recipientPhone) throw new ApiError('invalid_phone', 400);
  const paymentMethod = String(body.paymentMethod ?? '') as PaymentMethod;
  if (!catalog.config.paymentMethods.includes(paymentMethod)) throw new ApiError('invalid_payment_method', 400);
  const deliveryMethod = String(body.deliveryMethod ?? '') as DeliveryMethod;
  if (!['courier', 'post', 'pickup'].includes(deliveryMethod)) throw new ApiError('invalid_delivery_method', 400);
  const pickup = deliveryMethod === 'pickup';
  const city = pickup ? '' : String(body.city ?? '').trim().slice(0, 100);
  const address = pickup ? '' : String(body.address ?? '').trim().slice(0, 300);
  if (!pickup && (city.length < 2 || address.length < 5)) throw new ApiError('invalid_address', 400);

  const quote = buildQuote(s, { ...body, regionCode: pickup ? null : body.regionCode });
  if (quote.problems.length) throw new ApiError('cart_problems', 409, { problems: quote.problems });
  if (body.promoCode && !quote.promo.applied) throw new ApiError('promo_invalid', 409, { promo: quote.promo });

  for (const line of quote.lines) s.stock[line.variantId] = stockOf(s, line.variantId) - line.quantity;

  const now = new Date().toISOString();
  const online = paymentMethod !== 'cash';
  const order: DemoOrder = {
    owner: customer.phone,
    id: s.nextOrderId++,
    status: 'new',
    paymentMethod,
    paymentStatus: online ? 'paid' : 'pending',
    paymentUrl: null,
    deliveryMethod,
    regionCode: quote.regionCode,
    city,
    address,
    comment: String(body.comment ?? '').trim().slice(0, 500),
    recipientName,
    recipientPhone,
    recipientPhoneFormatted: formatPhone(recipientPhone),
    subtotal: quote.subtotal,
    discount: quote.discount,
    deliveryPrice: quote.delivery,
    total: quote.total,
    promoCode: quote.promo.applied ? quote.promo.code : null,
    createdAt: now,
    paidAt: online ? now : null,
    canCancel: !online,
    items: quote.lines.map((l, index) => ({
      id: index + 1, productId: l.productId, variantId: l.variantId, name: l.name, kind: l.kind,
      size: l.size, color: l.color, image: l.image, price: l.price, quantity: l.quantity,
    })),
    history: [
      { status: 'new', note: '', at: now },
      ...(online ? [{ status: 'paid' as const, note: paymentMethod, at: now }] : []),
    ],
  };
  s.orders.unshift(order);
  if (!customer.name) customer.name = recipientName;
  customer.lastAddress = pickup ? null : { regionCode: quote.regionCode ?? '', city, address };
  return publicOrder(order);
}

// ------------------------------------------------------------------ маршрутизация
export async function demoRequest<T>(method: string, fullPath: string, body: unknown, token: string | null): Promise<T> {
  const s = await load();
  const url = new URL(fullPath, 'http://demo.local');
  const path = url.pathname;
  const input = (body ?? {}) as Record<string, any>;
  const route = `${method} ${path}`;
  let match: RegExpMatchArray | null;
  let result: unknown;
  let changed = false;

  if (route === 'GET /api/config') {
    result = catalog.config;
  } else if (route === 'GET /api/categories') {
    result = catalog.categories.map((c) => ({
      ...c, productCount: catalog.products.filter((p) => p.categoryId === c.id).length,
    }));
  } else if (route === 'GET /api/regions') {
    result = catalog.regions;
  } else if (route === 'GET /api/products') {
    result = listProducts(s, url.searchParams);
  } else if (method === 'GET' && (match = path.match(/^\/api\/products\/([^/]+)$/))) {
    const product = catalog.products.find((p) => p.slug === decodeURIComponent(match![1]));
    if (!product) throw new ApiError('product_not_found', 404);
    result = details(s, product);
  } else if (route === 'POST /api/auth/request-code') {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new ApiError('invalid_phone', 400);
    const code = String(Math.floor(10000 + Math.random() * 90000));
    s.pendingCode = { phone, code, attempts: 0 };
    changed = true;
    result = { phone, resendIn: 60, length: 5, debugCode: code };
  } else if (route === 'POST /api/auth/verify') {
    const phone = normalizePhone(input.phone);
    const pending = s.pendingCode;
    if (!phone || !pending || pending.phone !== phone) throw new ApiError('otp_expired', 400);
    if (String(input.code) !== pending.code) {
      pending.attempts += 1;
      await persist();
      if (pending.attempts >= 5) throw new ApiError('otp_attempts', 429);
      throw new ApiError('otp_invalid', 400, { attemptsLeft: 5 - pending.attempts });
    }
    s.pendingCode = null;
    const customer = s.customers[phone] ?? {
      id: Object.keys(s.customers).length + 1,
      phone,
      phoneFormatted: formatPhone(phone),
      name: '',
      language: input.language === 'ru' ? 'ru' : 'uz',
      lastAddress: null,
    };
    s.customers[phone] = customer;
    changed = true;
    result = { token: `demo.${phone}`, customer };
  } else if (route === 'POST /api/auth/logout') {
    result = { ok: true };
  } else if (route === 'GET /api/me') {
    result = requireCustomer(s, token);
  } else if (route === 'PATCH /api/me') {
    const customer = requireCustomer(s, token);
    if (typeof input.name === 'string') customer.name = input.name.trim().slice(0, 100);
    if (input.language === 'uz' || input.language === 'ru') customer.language = input.language;
    changed = true;
    result = customer;
  } else if (route === 'DELETE /api/me') {
    const customer = requireCustomer(s, token);
    if (s.orders.some((o) => o.owner === customer.phone && ['new', 'confirmed', 'shipped'].includes(o.status))) {
      throw new ApiError('active_orders', 409);
    }
    delete s.customers[customer.phone];
    s.orders = s.orders.filter((o) => o.owner !== customer.phone);
    changed = true;
    result = { ok: true };
  } else if (route === 'POST /api/cart/quote') {
    result = buildQuote(s, input);
  } else if (route === 'GET /api/orders') {
    const customer = requireCustomer(s, token);
    result = s.orders.filter((o) => o.owner === customer.phone).map(publicOrder);
  } else if (route === 'POST /api/orders') {
    const customer = requireCustomer(s, token);
    result = createOrder(s, customer, input);
    changed = true;
  } else if (method === 'GET' && (match = path.match(/^\/api\/orders\/(\d+)$/))) {
    result = publicOrder(findOrder(s, requireCustomer(s, token), match[1]));
  } else if (method === 'POST' && (match = path.match(/^\/api\/orders\/(\d+)\/cancel$/))) {
    const order = findOrder(s, requireCustomer(s, token), match[1]);
    if (order.status !== 'new' || order.paymentStatus === 'paid') throw new ApiError('cannot_cancel', 409);
    order.status = 'cancelled';
    order.paymentStatus = 'cancelled';
    order.history.push({ status: 'cancelled', note: 'customer', at: new Date().toISOString() });
    for (const item of order.items) s.stock[item.variantId] = stockOf(s, item.variantId) + item.quantity;
    changed = true;
    result = publicOrder(order);
  } else {
    throw new ApiError('not_found', 404);
  }

  if (changed) await persist();
  // Копия: экраны не должны менять состояние демо-магазина напрямую
  return JSON.parse(JSON.stringify(result)) as T;
}
