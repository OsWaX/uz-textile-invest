/**
 * Хранение данных на устройстве. Корзина, избранное и язык — в AsyncStorage,
 * токен входа — в защищённом хранилище (SecureStore); в браузере SecureStore
 * недоступен, там токен хранится в AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Нехватка места или запрет хранилища не должны ломать приложение
  }
}

const TOKEN_KEY = 'jayron.token';
const useSecureStore = Platform.OS !== 'web';

export async function loadToken(): Promise<string | null> {
  try {
    return useSecureStore ? await SecureStore.getItemAsync(TOKEN_KEY) : await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  try {
    if (useSecureStore) {
      if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } else if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // см. saveJson
  }
}
