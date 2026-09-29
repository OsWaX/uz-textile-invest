/** Загрузка данных с сервера с простым кэшем в памяти: повторный заход на экран — мгновенный. */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from './api';

/** Обновляет данные при возвращении на экран (первый показ уже загружен useApi). */
export function useRefreshOnFocus(reload: () => void) {
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [reload]));
}

const cache = new Map<string, unknown>();

export function useApi<T>(path: string | null, { auth = false }: { auth?: boolean } = {}) {
  const [data, setData] = useState<T | null>(() => (path ? (cache.get(path) as T) ?? null : null));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    if (cache.has(path)) setData(cache.get(path) as T);
    setLoading(true);
    setError(null);
    api<T>('GET', path, { auth, signal: controller.signal })
      .then((fresh) => {
        if (controller.signal.aborted) return;
        if (!auth) cache.set(path, fresh);
        setData(fresh);
      })
      .catch((e: ApiError) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, auth, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}
