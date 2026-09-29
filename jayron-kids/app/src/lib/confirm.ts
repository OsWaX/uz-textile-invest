/** Диалог подтверждения: Alert на телефоне, window.confirm в браузере (там Alert без кнопок). */
import { Alert, Platform } from 'react-native';

export function confirmAsync(title: string, yes: string, no: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(title) ?? false);
  return new Promise((resolve) => {
    Alert.alert(title, undefined, [
      { text: no, style: 'cancel', onPress: () => resolve(false) },
      { text: yes, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
