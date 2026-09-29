import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/brand';
import { PaymentBadge, StatusBadge, StatusSteps } from '@/components/order';
import { ProductArt } from '@/components/product';
import { Button, Card, Divider, Row, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Order, Region } from '@/lib/types';
import { useApi, useRefreshOnFocus } from '@/lib/useApi';
import { colors, radius, space } from '@/theme';

export default function OrderScreen() {
  const { id, placed } = useLocalSearchParams<{ id: string; placed?: string }>();
  const { t, pick, lang, money, config, customer } = useStore();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { data: order, setData, loading, error, reload } = useApi<Order>(customer ? `/api/orders/${id}` : null, { auth: true });
  const regions = useApi<Region[]>('/api/regions');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useRefreshOnFocus(reload);

  // Пока онлайн-оплата не подтверждена, периодически проверяем статус
  const awaitingPayment = order && order.paymentMethod !== 'cash' && order.paymentStatus === 'pending' && order.status !== 'cancelled';
  useEffect(() => {
    if (!awaitingPayment) return;
    const timer = setInterval(reload, 5000);
    const stop = setTimeout(() => clearInterval(timer), 3 * 60 * 1000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [awaitingPayment, reload]);

  if (!customer) {
    return (
      <View style={styles.center}>
        <EmptyState title={t('guestTitle')} hint={t('guestText')} action={t('login')} onAction={() => router.push('/login')} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        {loading ? <ActivityIndicator color={colors.tealInk} /> : (
          <EmptyState title={t(error?.code === 'network' ? 'error_network' : 'error_unknown')} action={t('retry')} onAction={reload} />
        )}
      </View>
    );
  }

  const pay = async () => {
    if (!order.paymentUrl) return;
    await WebBrowser.openBrowserAsync(order.paymentUrl).catch(() => {});
    reload();
  };

  const cancel = async () => {
    if (!(await confirmAsync(t('cancelConfirm'), t('yes'), t('no')))) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<Order>('POST', `/api/orders/${order.id}/cancel`, { auth: true }));
    } catch (e) {
      const key = `error_${(e as ApiError).code}` as 'error_unknown';
      const text = t(key);
      setActionError(text === key ? t('error_unknown') : text);
    } finally {
      setBusy(false);
    }
  };

  const region = regions.data?.find((r) => r.code === order.regionCode);
  const deliveryTitle = t(order.deliveryMethod);
  const contentWidth = Math.min(width, 720);
  const historyLabel = (status: string) => t(`status_${status}` as 'status_new');
  const noteLabel = (note: string) => {
    const key = `note_${note}` as 'note_cash';
    const text = t(key);
    return text === key ? note : text;
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { width: contentWidth, paddingBottom: insets.bottom + space.xxl }]}>
      <Stack.Screen options={{ title: t('order', { id: order.id }) }} />

      {placed === '1' && order.status !== 'cancelled' ? (
        <View style={styles.success}>
          <Ionicons name="checkmark-circle" size={32} color={colors.leafInk} />
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="h3">{t('orderPlaced')}</T>
            <T variant="body">{t('orderPlacedHint')}</T>
          </View>
        </View>
      ) : null}

      <Card>
        <View style={styles.badges}>
          <StatusBadge status={order.status} />
          <PaymentBadge order={order} />
        </View>
        <T variant="small">{formatDate(order.createdAt, lang)}</T>
        {order.status !== 'cancelled' ? <StatusSteps status={order.status} /> : null}
        {order.paymentUrl ? (
          <Button title={t('pay', { sum: money(order.total) })} icon="card-outline" onPress={pay} />
        ) : null}
      </Card>

      <Card>
        <T variant="h3">{t('items')}</T>
        {order.items.map((i) => (
          <View key={i.id} style={styles.item}>
            <View style={styles.itemArt}>
              <ProductArt image={i.image} kind={i.kind} color={i.color.hex} size={46} rounded={radius.md} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="bodyBold" numberOfLines={2}>{pick(i.name)}</T>
              <T variant="small">{pick(i.color.name)} · {i.size} · {i.quantity} {t('pcs')}</T>
            </View>
            <T variant="bodyBold">{money(i.price * i.quantity)}</T>
          </View>
        ))}
        <Divider />
        <Row label={t('subtotal')} value={money(order.subtotal)} />
        {order.discount ? <Row label={`${t('discount')}${order.promoCode ? ` (${order.promoCode})` : ''}`} value={`−${money(order.discount)}`} valueColor={colors.coralInk} /> : null}
        <Row label={t('delivery')} value={order.deliveryPrice ? money(order.deliveryPrice) : t('free')} />
        <Row bold label={t('total')} value={money(order.total)} />
        <T variant="small">{t('payment')}: {t(order.paymentMethod)}</T>
      </Card>

      <Card>
        <T variant="h3">{deliveryTitle}</T>
        <T variant="bodyBold">{order.recipientName} · {order.recipientPhoneFormatted}</T>
        {order.deliveryMethod === 'pickup' ? (
          <T variant="body">{pick(config?.pickupAddress)}</T>
        ) : (
          <T variant="body">{[pick(region?.name), order.city, order.address].filter(Boolean).join(', ')}</T>
        )}
        {order.comment ? <T variant="small">{order.comment}</T> : null}
      </Card>

      <Card>
        {order.history.map((h, index) => (
          <View key={`${h.status}-${index}`} style={styles.historyRow}>
            <View style={[styles.historyDot, index === order.history.length - 1 && styles.historyDotLast]} />
            <View style={{ flex: 1 }}>
              <T variant="bodyBold">{historyLabel(h.status)}{h.note ? ` · ${noteLabel(h.note)}` : ''}</T>
              <T variant="small">{formatDate(h.at, lang)}</T>
            </View>
          </View>
        ))}
      </Card>

      {order.canCancel ? (
        <View style={{ gap: space.sm }}>
          {actionError ? <T variant="bodyBold" color={colors.coralInk}>{actionError}</T> : null}
          <Button title={t('cancelOrder')} variant="danger" icon="close-circle-outline" onPress={cancel} loading={busy} />
        </View>
      ) : null}

      {config ? (
        <Card>
          <T variant="h3">{t('help')}</T>
          <View style={styles.helpRow}>
            <Button small variant="secondary" icon="call-outline" title={t('call')} style={{ flex: 1 }}
              onPress={() => Linking.openURL(`tel:${config.supportPhone.replace(/[^\d+]/g, '')}`)} />
            <Button small variant="secondary" icon="paper-plane-outline" title="Telegram" style={{ flex: 1 }}
              onPress={() => Linking.openURL(`https://t.me/${config.telegram}`)} />
          </View>
        </Card>
      ) : null}

      <Button title={t('goToCatalog')} variant="ghost" onPress={() => router.navigate('/catalog')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  content: { alignSelf: 'center', padding: space.lg, gap: space.md },
  success: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: colors.leafSoft, borderRadius: radius.lg, padding: space.lg },
  badges: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  itemArt: { width: 60 },
  historyRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  historyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.line, marginTop: 6 },
  historyDotLast: { backgroundColor: colors.tealInk },
  helpRow: { flexDirection: 'row', gap: space.sm },
});
