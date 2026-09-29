/** Расчёт корзины на сервере: цены, наличие, промокод, доставка. Запрос уходит с небольшой задержкой. */
import { useEffect, useState } from 'react';

import { api, ApiError } from './api';
import type { CartItem, DeliveryMethod, Quote } from './types';

type Input = { items: CartItem[]; promoCode: string; deliveryMethod?: DeliveryMethod; regionCode?: string | null };

export function useQuote({ items, promoCode, deliveryMethod, regionCode }: Input) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const key = JSON.stringify([items.map((i) => [i.variantId, i.quantity]), promoCode, deliveryMethod, regionCode, version]);

  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Quote>('POST', '/api/cart/quote', {
        body: {
          items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          promoCode: promoCode || undefined,
          deliveryMethod: deliveryMethod ?? 'pickup',
          regionCode: regionCode ?? undefined,
        },
        signal: controller.signal,
      })
        .then((fresh) => {
          if (controller.signal.aborted) return;
          setQuote(fresh);
          setError(null);
        })
        .catch((e: ApiError) => { if (!controller.signal.aborted) setError(e); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { quote, error, loading, reload: () => setVersion((v) => v + 1) };
}
