/** Статус заказа: цветная метка и шкала этапов доставки. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useStore } from '@/lib/store';
import type { Order, OrderStatus, PaymentStatus } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

const STATUS_COLORS: Record<OrderStatus, { bg: string; fg: string }> = {
  new: { bg: colors.sunnySoft, fg: '#7A5700' },
  confirmed: { bg: colors.skySoft, fg: '#1F6C99' },
  shipped: { bg: colors.tealSoft, fg: colors.tealInk },
  delivered: { bg: colors.leafSoft, fg: colors.leafInk },
  cancelled: { bg: '#EEEEEE', fg: '#555555' },
};

const PAYMENT_COLORS: Record<PaymentStatus, { bg: string; fg: string }> = {
  pending: { bg: colors.coralSoft, fg: colors.coralInk },
  paid: { bg: colors.leafSoft, fg: colors.leafInk },
  cancelled: { bg: '#EEEEEE', fg: '#555555' },
  refunded: { bg: '#EEEEEE', fg: '#555555' },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useStore();
  const c = STATUS_COLORS[status];
  return <Text style={[styles.badge, { backgroundColor: c.bg, color: c.fg }]}>{t(`status_${status}`)}</Text>;
}

export function PaymentBadge({ order }: { order: Pick<Order, 'paymentStatus' | 'paymentMethod' | 'status'> }) {
  const { t } = useStore();
  // Для оплаты наличными «ожидает оплаты» — нормальное состояние до вручения, метку не показываем
  if (order.paymentMethod === 'cash' && order.paymentStatus === 'pending') return null;
  if (order.status === 'cancelled' && order.paymentStatus === 'cancelled') return null;
  const c = PAYMENT_COLORS[order.paymentStatus];
  return <Text style={[styles.badge, { backgroundColor: c.bg, color: c.fg }]}>{t(`payment_${order.paymentStatus}`)}</Text>;
}

const STEPS: OrderStatus[] = ['new', 'confirmed', 'shipped', 'delivered'];

export function StatusSteps({ status }: { status: OrderStatus }) {
  const { t } = useStore();
  const current = STEPS.indexOf(status);
  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 3, now: Math.max(current, 0) }}>
      {STEPS.map((step, index) => {
        const done = index <= current;
        return (
          <View key={step} style={styles.step}>
            <View style={styles.stepTrack}>
              <View style={[styles.stepLine, index === 0 && styles.hidden, done && styles.stepLineDone]} />
              <View style={[styles.stepDot, done && styles.stepDotDone]}>
                {done ? <Ionicons name="checkmark" size={14} color={colors.paper} /> : null}
              </View>
              <View style={[styles.stepLine, index === STEPS.length - 1 && styles.hidden, index < current && styles.stepLineDone]} />
            </View>
            <Text style={[styles.stepText, done && styles.stepTextDone]} numberOfLines={2}>{t(`status_${step}`)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', fontFamily: fonts.heavy, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill, overflow: 'hidden',
  },
  steps: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  stepTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLine: { flex: 1, height: 3, backgroundColor: colors.line },
  stepLineDone: { backgroundColor: colors.leaf },
  hidden: { opacity: 0 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.paper, borderWidth: 2, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.leafInk, borderColor: colors.leafInk },
  stepText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.inkSoft, textAlign: 'center' },
  stepTextDone: { fontFamily: fonts.bodyBold, color: colors.ink },
});
