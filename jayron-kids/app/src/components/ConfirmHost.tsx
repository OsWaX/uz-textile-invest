import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { registerConfirmHost, type ConfirmRequest } from '@/lib/confirm';
import { colors, radius, space } from '@/theme';
import { Button, T } from './ui';

/** Окно подтверждения для confirmAsync(); монтируется один раз в корневом макете. */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => registerConfirmHost(setRequest), []);

  const answer = (value: boolean) => {
    request?.resolve(value);
    setRequest(null);
  };

  return (
    <Modal visible={Boolean(request)} transparent animationType="fade" onRequestClose={() => answer(false)}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => answer(false)} accessibilityLabel={request?.no} />
        <View style={styles.card} accessibilityRole="alert">
          <T variant="h3" center>{request?.title}</T>
          <View style={styles.buttons}>
            <Button title={request?.no ?? ''} variant="ghost" onPress={() => answer(false)} style={styles.button} />
            <Button title={request?.yes ?? ''} variant="danger" onPress={() => answer(true)} style={styles.button} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.paper, borderRadius: radius.lg, padding: space.xl, gap: space.lg },
  buttons: { flexDirection: 'row', gap: space.sm },
  button: { flex: 1 },
});
