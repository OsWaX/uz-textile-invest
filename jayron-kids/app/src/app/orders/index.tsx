import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EmptyState } from '@/components/brand';
import { PaymentBadge, StatusBadge } from '@/components/order';
import { ProductArt } from '@/components/product';
import { T } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Order } from '@/lib/types';
import { useApi, useRefreshOnFocus } from '@/lib/useApi';
import { colors, radius, space } from '@/theme';

export default function OrdersScreen() {
  const { t, lang, money, customer } = useStore();
  const { width } = useWindowDimensions();
  const { data, loading, error, reload } = useApi<Order[]>(customer ? '/api/orders' : null, { auth: true });

  // Статус и оплата меняются на сервере — обновляем при каждом возврате на экран
  useRefreshOnFocus(reload);

  if (!customer) {
    return <EmptyState title={t('guestTitle')} hint={t('guestText')} action={t('login')} onAction={() => router.push('/login')} />;
  }

  const contentWidth = Math.min(width, 720);
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(o) => String(o.id)}
      style={styles.list}
      contentContainerStyle={[styles.content, { width: contentWidth }]}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: '/orders/[id]', params: { id: String(item.id) } })}
          accessibilityRole="link"
          accessibilityLabel={t('order', { id: item.id })}
        >
          <View style={styles.cardTop}>
            <T variant="h3">{t('order', { id: item.id })}</T>
            <T variant="price">{money(item.total)}</T>
          </View>
          <T variant="small">{formatDate(item.createdAt, lang)} · {t('itemsCount', { count: item.items.reduce((s, i) => s + i.quantity, 0) })}</T>
          <View style={styles.badges}>
            <StatusBadge status={item.status} />
            <PaymentBadge order={item} />
          </View>
          <View style={styles.thumbs}>
            {item.items.slice(0, 5).map((i) => (
              <View key={i.id} style={styles.thumb}>
                <ProductArt image={i.image} kind={i.kind} color={i.color.hex} size={40} rounded={radius.sm} />
              </View>
            ))}
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        loading ? <ActivityIndicator color={colors.tealInk} style={{ marginTop: 48 }} />
          : error ? <EmptyState title={t('error_network')} action={t('retry')} onAction={reload} />
            : <EmptyState title={t('noOrders')} hint={t('noOrdersHint')} action={t('goToCatalog')} onAction={() => router.navigate('/catalog')} />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.cream },
  content: { alignSelf: 'center', padding: space.lg, gap: space.md },
  card: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badges: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  thumbs: { flexDirection: 'row', gap: space.sm },
  thumb: { width: 52 },
});
