/**
 * Состояние приложения: язык, корзина, избранное, вход покупателя, настройки магазина.
 * Всё, кроме настроек магазина, сохраняется на устройстве.
 */
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { formatMoney } from './format';
import { pick as pickLocalized, translate, type TextKey } from './i18n';
import { loadJson, loadToken, saveJson, saveToken } from './storage';
import type { CartItem, Customer, Lang, Localized, ShopConfig } from './types';

const MAX_QUANTITY = 20;

type Store = {
  ready: boolean;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TextKey, vars?: Record<string, string | number>) => string;
  money: (value: number) => string;
  pick: (value: Localized | null | undefined) => string;

  config: ShopConfig | null;

  cart: CartItem[];
  cartCount: number;
  addToCart: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  setQuantity: (variantId: number, quantity: number) => void;
  removeFromCart: (variantId: number) => void;
  clearCart: () => void;
  promoCode: string;
  setPromoCode: (code: string) => void;

  favorites: number[];
  isFavorite: (productId: number) => boolean;
  toggleFavorite: (productId: number) => void;

  customer: Customer | null;
  signIn: (token: string, customer: Customer) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  setCustomer: (customer: Customer) => void;
};

const StoreContext = createContext<Store | null>(null);

const deviceLang = (): Lang => (getLocales()[0]?.languageCode === 'ru' ? 'ru' : 'uz');

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>(deviceLang);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [promoCode, setPromoCodeState] = useState('');
  const [favorites, setFavorites] = useState<number[]>([]);
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const hydrated = useRef(false);

  // Восстановление сохранённого состояния при запуске
  useEffect(() => {
    (async () => {
      const [savedLang, savedCart, savedFavorites, savedPromo, token] = await Promise.all([
        loadJson<Lang | null>('jayron.lang', null),
        loadJson<CartItem[]>('jayron.cart', []),
        loadJson<number[]>('jayron.favorites', []),
        loadJson<string>('jayron.promo', ''),
        loadToken(),
      ]);
      if (savedLang === 'uz' || savedLang === 'ru') setLangState(savedLang);
      setCart(Array.isArray(savedCart) ? savedCart : []);
      setFavorites(Array.isArray(savedFavorites) ? savedFavorites : []);
      setPromoCodeState(typeof savedPromo === 'string' ? savedPromo : '');
      if (token) {
        setAuthToken(token);
        setCustomerState(await loadJson<Customer | null>('jayron.customer', null));
        // Профиль уточняется в фоне; при недействительном токене сработает выход
        api<Customer>('GET', '/api/me', { auth: true })
          .then((fresh) => {
            setCustomerState(fresh);
            saveJson('jayron.customer', fresh);
          })
          .catch(() => {});
      }
      hydrated.current = true;
      setReady(true);
    })();
  }, []);

  // Настройки магазина: способы оплаты, бесплатная доставка, контакты
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const load = () => {
      api<ShopConfig>('GET', '/api/config')
        .then((data) => { if (!cancelled) setConfig(data); })
        .catch(() => {
          attempt += 1;
          if (!cancelled) setTimeout(load, Math.min(30000, 2000 * attempt));
        });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (hydrated.current) saveJson('jayron.cart', cart); }, [cart]);
  useEffect(() => { if (hydrated.current) saveJson('jayron.favorites', favorites); }, [favorites]);
  useEffect(() => { if (hydrated.current) saveJson('jayron.promo', promoCode); }, [promoCode]);

  const signOut = useCallback(async () => {
    const hadToken = customer !== null;
    if (hadToken) await api('POST', '/api/auth/logout', { auth: true }).catch(() => {});
    setAuthToken(null);
    setCustomerState(null);
    await Promise.all([saveToken(null), saveJson('jayron.customer', null)]);
  }, [customer]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setCustomerState(null);
      saveToken(null);
      saveJson('jayron.customer', null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  /** Удаляет аккаунт на сервере; ошибку (например, active_orders) пробрасывает экрану. */
  const deleteAccount = useCallback(async () => {
    await api('DELETE', '/api/me', { auth: true });
    setAuthToken(null);
    setCustomerState(null);
    await Promise.all([saveToken(null), saveJson('jayron.customer', null)]);
  }, []);

  const signIn = useCallback(async (token: string, fresh: Customer) => {
    setAuthToken(token);
    setCustomerState(fresh);
    await Promise.all([saveToken(token), saveJson('jayron.customer', fresh)]);
  }, []);

  const setCustomer = useCallback((fresh: Customer) => {
    setCustomerState(fresh);
    saveJson('jayron.customer', fresh);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveJson('jayron.lang', next);
    if (customer) api('PATCH', '/api/me', { auth: true, body: { language: next } }).catch(() => {});
  }, [customer]);

  const addToCart = useCallback((item: Omit<CartItem, 'quantity'>, quantity = 1) => {
    setCart((current) => {
      const existing = current.find((i) => i.variantId === item.variantId);
      if (existing) {
        return current.map((i) => (i.variantId === item.variantId
          ? { ...i, ...item, quantity: Math.min(MAX_QUANTITY, i.quantity + quantity) }
          : i));
      }
      return [...current, { ...item, quantity: Math.min(MAX_QUANTITY, quantity) }];
    });
  }, []);

  const setQuantity = useCallback((variantId: number, quantity: number) => {
    setCart((current) => (quantity <= 0
      ? current.filter((i) => i.variantId !== variantId)
      : current.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(MAX_QUANTITY, quantity) } : i))));
  }, []);

  const removeFromCart = useCallback((variantId: number) => {
    setCart((current) => current.filter((i) => i.variantId !== variantId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setPromoCodeState('');
  }, []);

  const toggleFavorite = useCallback((productId: number) => {
    setFavorites((current) => (current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [productId, ...current]));
  }, []);

  const value = useMemo<Store>(() => ({
    ready,
    lang,
    setLang,
    t: (key, vars) => translate(lang, key, vars),
    money: (amount) => formatMoney(amount, lang),
    pick: (localized) => pickLocalized(lang, localized),
    config,
    cart,
    cartCount: cart.reduce((sum, i) => sum + i.quantity, 0),
    addToCart,
    setQuantity,
    removeFromCart,
    clearCart,
    promoCode,
    setPromoCode: setPromoCodeState,
    favorites,
    isFavorite: (id) => favorites.includes(id),
    toggleFavorite,
    customer,
    signIn,
    signOut,
    deleteAccount,
    setCustomer,
  }), [ready, lang, setLang, config, cart, addToCart, setQuantity, removeFromCart, clearCart, promoCode,
    favorites, toggleFavorite, customer, signIn, signOut, deleteAccount, setCustomer]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore вызван вне StoreProvider');
  return store;
}
