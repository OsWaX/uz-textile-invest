/**
 * Клиент API магазина. Адрес сервера берётся из EXPO_PUBLIC_API_URL; при разработке
 * без него используется компьютер, на котором запущен Metro, порт 4000 — так
 * телефон с Expo Go сразу видит локальный сервер.
 *
 * С EXPO_PUBLIC_DEMO=1 сервер не нужен: запросы обрабатывает демо-магазин внутри
 * приложения (см. lib/demo) — так веб-версию можно показать по одной ссылке.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { demoRequest } from './demo/server';
import { ApiError } from './errors';

export { ApiError };

export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === '1';

function detectApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000'; // эмулятор Android
  return 'http://localhost:4000';
}

export const API_URL = detectApiUrl();

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type Options = { body?: unknown; auth?: boolean; signal?: AbortSignal };

export async function api<T>(method: string, path: string, { body, auth = false, signal }: Options = {}): Promise<T> {
  if (DEMO_MODE) {
    try {
      return await demoRequest<T>(method, path, body, auth ? authToken : null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && auth) onUnauthorized?.();
      throw error;
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && authToken) headers.Authorization = `Bearer ${authToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  signal?.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(signal?.aborted ? 'aborted' : 'network', 0);
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && auth) onUnauthorized?.();
    throw new ApiError(data?.error || 'unknown', response.status, data?.details);
  }
  return data as T;
}

/** Полный адрес картинки: сервер отдаёт пути вида /uploads/… */
export const imageUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${API_URL}${path}`);
