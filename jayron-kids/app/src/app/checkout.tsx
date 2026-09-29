import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Divider, Field, Row, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatLocalPhone, fullPhone, localDigits } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { DeliveryMethod, Order, PaymentMethod, Region } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { useQuote } from '@/lib/useQuote';
import { colors, fonts, radius, space } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function CheckoutScreen() {
  const { t, pick, money, lang, cart, promoCode, customer, config, clearCart } = useStore();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const regions = useApi<Region[]>('/api/regions');

  const last = customer?.lastAddress ?? null;
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer ? localDigits(customer.phone) : '');
  const [delivery, setDelivery] = useState<DeliveryMethod>(last && last.regionCode !== 'tashkent_city' ? 'post' : 'courier');
  const [regionCode, setRegionCode] = useState<string | null>(last?.regionCode ?? 'tashkent_city');
  const [city, setCity] = useState(last?.city ?? '');
  const [address, setAddress] = useState(last?.address ?? '');
  const [comment, setComment] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [regionPicker, setRegionPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // После оформления корзина пустеет — это не повод уводить покупателя в корзину
  const placed = useRef(false);

  const region = regions.data?.find((r) => r.code === regionCode) ?? null;

  // Курьер ездит не во все регионы — тогда предлагаем почту
  useEffect(() => {
    if (delivery === 'courier' && region && region.courierPrice === null) setDelivery('post');
  }, [region, delivery]);

  const { quote, loading: quoting } = useQuote({
    items: cart,
    promoCode,
    deliveryMethod: delivery,
    regionCode: delivery === 'pickup' ? null : regionCode,
  });

  useEffect(() => {
    if (!cart.length && !placed.current) router.replace('/cart');
  }, [cart.length]);

  const methods = config?.paymentMethods ?? ['cash'];
  const needsAddress = delivery !== 'pickup';
  const nameError = touched && name.trim().length < 2 ? t('error_invalid_name') : null;
  const phoneError = touched && phone.length !== 9 ? t('error_invalid_phone') : null;
  const addressError = touched && needsAddress && (city.trim().length < 2 || address.trim().length < 5) ? t('error_invalid_address') : null;
  const regionError = touched && needsAddress && !region ? t('error_region_required') : null;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (name.trim().length < 2 || phone.length !== 9 || (needsAddress && (!region || city.trim().length < 2 || address.trim().length < 5))) return;
    setBusy(true);
    try {
      const order = await api<Order>('POST', '/api/orders', {
        auth: true,
        body: {
          items: cart.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          recipientName: name.trim(),
          recipientPhone: fullPhone(phone),
          deliveryMethod: delivery,
          regionCode: needsAddress ? regionCode : null,
          city: city.trim(),
          address: address.trim(),
          comment: comment.trim(),
          paymentMethod: payment,
          promoCode: promoCode || undefined,
          language: lang,
        },
      });
      placed.current = true;
      clearCart();
      if (order.paymentUrl) await WebBrowser.openBrowserAsync(order.paymentUrl).catch(() => {});
      router.replace({ pathname: '/orders/[id]', params: { id: String(order.id), placed: '1' } });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        router.push({ pathname: '/login', params: { next: 'checkout' } });
      } else if (err.code === 'cart_problems') {
        setError(t('error_cart_problems'));
      } else {
        const key = `error_${err.code}` as 'error_unknown';
        const text = t(key);
        setError(text === key ? t('error_unknown') : text);
      }
    } finally {
      if (!placed.current) setBusy(false);
    }
  };

  const contentWidth = Math.min(width, 720);
  const deliveryOptions: { code: DeliveryMethod; icon: IconName; title: string; hint: string; price: string | null }[] = [
    {
      code: 'courier', icon: 'bicycle-outline', title: t('courier'), hint: t('courierHint'),
      price: region?.courierPrice != null ? money(region.courierPrice) : null,
    },
    { code: 'post', icon: 'cube-outline', title: t('post'), hint: t('postHint'), price: region ? money(region.postPrice) : null },
    { code: 'pickup', icon: 'storefront-outline', title: t('pickup'), hint: t('pickupHint'), price: t('free') },
  ];
  const paymentOptions: { code: PaymentMethod; icon: IconName; title: string; hint: string }[] = [
    { code: 'cash', icon: 'cash-outline', title: t('cash'), hint: t('cashHint') },
    { code: 'payme', icon: 'card-outline', title: t('payme'), hint: t('paymeHint') },
    { code: 'click', icon: 'phone-portrait-outline', title: t('click'), hint: t('clickHint') },
  ];

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={[styles.content, { width: contentWidth, paddingBottom: insets.bottom + space.xxl }]} keyboardShouldPersistTaps="handled">
        {/* Получатель */}
        <Card>
          <T variant="h3">{t('recipient')}</T>
          <Field label={t('name')} value={name} onChangeText={setName} placeholder={t('namePlaceholder')}
            autoComplete="name" textContentType="name" error={nameError} />
          <Field label={t('phone')} prefix="+998" value={formatLocalPhone(phone)} onChangeText={(v) => setPhone(localDigits(v))}
            keyboardType="phone-pad" placeholder="90 123 45 67" maxLength={12} error={phoneError} />
        </Card>

        {/* Доставка */}
        <Card>
          <T variant="h3">{t('deliveryMethod')}</T>
          <View style={styles.options}>
            {deliveryOptions.map((o) => {
              const disabled = o.code === 'courier' && region?.courierPrice === null;
              return (
                <Option key={o.code} icon={o.icon} title={o.title} hint={disabled ? t('noCourier') : o.hint}
                  extra={disabled ? null : o.price} active={delivery === o.code} disabled={disabled} onPress={() => setDelivery(o.code)} />
              );
            })}
          </View>

          {needsAddress ? (
            <>
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>{t('region')}</Text>
                <Pressable style={[styles.select, regionError ? { borderColor: colors.coralInk } : null]} onPress={() => setRegionPicker(true)}
                  accessibilityRole="button" accessibilityLabel={t('region')}>
                  <Text style={[styles.selectText, !region && { color: '#A8917D' }]}>{region ? pick(region.name) : t('chooseRegion')}</Text>
                  <Ionicons name="chevron-down" size={18} color={colors.inkSoft} />
                </Pressable>
                {regionError ? <T variant="small" color={colors.coralInk}>{regionError}</T> : null}
                {region && delivery === 'post' ? <T variant="small">{t('days', { days: region.postDays })}</T> : null}
              </View>
              <Field label={t('city')} value={city} onChangeText={setCity} placeholder={t('cityPlaceholder')} />
              <Field label={t('address')} value={address} onChangeText={setAddress} placeholder={t('addressPlaceholder')}
                autoComplete="street-address" error={addressError} multiline style={{ minHeight: 48 }} />
              <Field label={t('comment')} value={comment} onChangeText={setComment} placeholder={t('commentPlaceholder')} maxLength={500} />
            </>
          ) : (
            <View style={styles.pickup}>
              <Ionicons name="location-outline" size={20} color={colors.tealInk} />
              <View style={{ flex: 1 }}>
                <T variant="label">{t('pickupAddress')}</T>
                <T variant="bodyBold">{pick(config?.pickupAddress)}</T>
              </View>
            </View>
          )}
        </Card>

        {/* Оплата */}
        <Card>
          <T variant="h3">{t('payment')}</T>
          <View style={styles.options}>
            {paymentOptions.filter((o) => methods.includes(o.code)).map((o) => (
              <Option key={o.code} icon={o.icon} title={o.title} hint={o.hint} active={payment === o.code} onPress={() => setPayment(o.code)} />
            ))}
          </View>
          {config?.demoPayments && payment !== 'cash' ? (
            <View style={styles.demo}><T variant="small" color={colors.ink}>{t('demoPayments')}</T></View>
          ) : null}
        </Card>

        {/* Итог */}
        <Card>
          <Row label={t('subtotal')} value={quote ? money(quote.subtotal) : '…'} />
          {quote?.discount ? <Row label={`${t('discount')} (${quote.promo.code})`} value={`−${money(quote.discount)}`} valueColor={colors.coralInk} /> : null}
          <Row label={t('delivery')} value={!quote ? '…' : quote.delivery ? money(quote.delivery) : t('free')}
            valueColor={quote && !quote.delivery ? colors.leafInk : undefined} />
          <Divider />
          <Row bold label={t('total')} value={quote ? money(quote.total) : '…'} />
          {error ? <T variant="bodyBold" color={colors.coralInk} accessibilityLiveRegion="polite">{error}</T> : null}
          <Button
            title={payment === 'cash' ? t('placeOrder') : t('payAndOrder')}
            icon={payment === 'cash' ? 'checkmark-circle-outline' : 'card-outline'}
            onPress={submit}
            loading={busy}
            disabled={!quote || quoting}
          />
          <T variant="small" center>{t('agreement')}</T>
        </Card>
      </ScrollView>

      <Modal visible={regionPicker} animationType="slide" transparent onRequestClose={() => setRegionPicker(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRegionPicker(false)} accessibilityLabel={t('close')} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <T variant="h2">{t('chooseRegion')}</T>
            <Pressable onPress={() => setRegionPicker(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('close')}>
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView>
            {(regions.data ?? []).map((r) => (
              <Pressable
                key={r.code}
                style={[styles.regionRow, r.code === regionCode && styles.regionRowActive]}
                onPress={() => { setRegionCode(r.code); setRegionPicker(false); }}
                accessibilityRole="radio"
                accessibilityState={{ checked: r.code === regionCode }}
              >
                <View style={{ flex: 1 }}>
                  <T variant="bodyBold">{pick(r.name)}</T>
                  <T variant="small">
                    {r.courierPrice != null ? `${t('courier')}: ${money(r.courierPrice)} · ` : ''}{t('post')}: {money(r.postPrice)}
                  </T>
                </View>
                {r.code === regionCode ? <Ionicons name="checkmark-circle" size={22} color={colors.tealInk} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Option({ icon, title, hint, extra, active, disabled, onPress }: {
  icon: IconName; title: string; hint: string; extra?: string | null; active: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      style={[styles.option, active && styles.optionActive, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={24} color={active ? colors.tealInk : colors.inkSoft} />
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
      {extra ? <Text style={styles.optionExtra}>{extra}</Text> : null}
      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? colors.tealInk : colors.line} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { alignSelf: 'center', padding: space.lg, gap: space.md },
  options: { gap: space.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.paper,
  },
  optionActive: { borderColor: colors.tealInk, backgroundColor: colors.tealSoft },
  optionTitle: { fontFamily: fonts.heavy, fontSize: 15, color: colors.ink },
  optionHint: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.inkSoft },
  optionExtra: { fontFamily: fonts.heavy, fontSize: 14, color: colors.ink },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft },
  select: {
    minHeight: 50, borderRadius: radius.md - 2, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper,
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  pickup: { flexDirection: 'row', gap: space.sm, backgroundColor: colors.tealSoft, borderRadius: radius.md, padding: space.md },
  demo: { backgroundColor: colors.sunnySoft, borderRadius: radius.md, padding: space.md },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '75%', backgroundColor: colors.cream, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.md },
  regionRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  regionRowActive: { backgroundColor: colors.tealSoft },
});
