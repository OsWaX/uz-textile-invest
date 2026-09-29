/** Типы данных API магазина. */
export type Lang = 'uz' | 'ru';
export type Localized = { uz: string; ru: string };

export type GarmentKind =
  | 'bodysuit' | 'romper' | 'tshirt' | 'sweatshirt' | 'hoodie' | 'set'
  | 'pants' | 'shorts' | 'dress' | 'pajama' | 'jacket' | 'cap';

export type Category = {
  id: number;
  slug: string;
  name: Localized;
  color: string;
  kind: GarmentKind;
  productCount: number;
};

export type ProductColor = { code: string; hex: string; name: Localized };

export type Product = {
  id: number;
  slug: string;
  categoryId: number;
  categorySlug: string;
  name: Localized;
  kind: GarmentKind;
  gender: 'boy' | 'girl' | 'unisex';
  price: number;
  oldPrice: number | null;
  images: string[];
  isNew: boolean;
  isHit: boolean;
  colors: ProductColor[];
  sizes: string[];
  inStock: boolean;
};

export type Variant = { id: number; sku: string; size: string; colorCode: string; stock: number };

export type ProductDetails = Product & {
  description: Localized;
  material: Localized;
  variants: Variant[];
};

export type Region = {
  code: string;
  name: Localized;
  courierPrice: number | null;
  postPrice: number;
  postDays: string;
};

export type ShopConfig = {
  name: string;
  supportPhone: string;
  telegram: string;
  instagram: string;
  pickupAddress: Localized;
  freeDeliveryFrom: number;
  minOrderTotal: number;
  paymentMethods: PaymentMethod[];
  demoPayments: boolean;
};

export type PaymentMethod = 'cash' | 'payme' | 'click';
export type DeliveryMethod = 'courier' | 'post' | 'pickup';

/** Позиция корзины хранится на устройстве; цены и наличие уточняет сервер. */
export type CartItem = {
  variantId: number;
  productId: number;
  slug: string;
  name: Localized;
  kind: GarmentKind;
  size: string;
  color: { hex: string; name: Localized };
  image: string | null;
  price: number;
  quantity: number;
};

export type QuoteProblem = {
  code: 'unavailable' | 'out_of_stock' | 'min_order' | 'region_required' | 'courier_unavailable';
  variantId?: number;
  available?: number;
  minTotal?: number;
};

export type Quote = {
  lines: (Omit<CartItem, 'quantity'> & { quantity: number; available: number; lineTotal: number })[];
  subtotal: number;
  discount: number;
  delivery: number;
  total: number;
  deliveryMethod: DeliveryMethod;
  regionCode: string | null;
  promo: { code: string; applied: boolean; error: string | null; minTotal: number | null };
  problems: QuoteProblem[];
  freeDeliveryFrom: number;
  minOrderTotal: number;
};

export type Customer = {
  id: number;
  phone: string;
  phoneFormatted: string;
  name: string;
  language: Lang;
  lastAddress: { regionCode: string; city: string; address: string } | null;
};

export type OrderStatus = 'new' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'cancelled' | 'refunded';

export type Order = {
  id: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentUrl: string | null;
  deliveryMethod: DeliveryMethod;
  regionCode: string | null;
  city: string;
  address: string;
  comment: string;
  recipientName: string;
  recipientPhone: string;
  recipientPhoneFormatted: string;
  subtotal: number;
  discount: number;
  deliveryPrice: number;
  total: number;
  promoCode: string | null;
  createdAt: string;
  paidAt: string | null;
  canCancel: boolean;
  items: {
    id: number;
    productId: number;
    variantId: number;
    name: Localized;
    kind: GarmentKind;
    size: string;
    color: { hex: string; name: Localized };
    image: string | null;
    price: number;
    quantity: number;
  }[];
  history: { status: OrderStatus | 'paid'; note: string; at: string }[];
};
