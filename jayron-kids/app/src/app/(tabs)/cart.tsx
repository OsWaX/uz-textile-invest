import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/brand';
import { ProductArt, QuantityStepper } from '@/components/product';
import { Button, Card, Divider, Row, T } from '@/components/ui';
import { ageForSize } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { useQuote } from '@/lib/useQuote';
import { colors, fonts, radius, space } from '@/theme';

export default function CartScreen() {
  const { t, pick, lang, money, cart, setQuantity, removeFromCart, promoCode, setPromoCode, customer, config } = useStore();
  const { width } = useWindowDimensions();
  const [promoText, setPromoText] = useState(promoCode);
  const { quote, loading, error } = useQuote({ items: cart, promoCode });

  if (!cart.length) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <EmptyState
          title={t('cartEmpty')}
          hint={t('cartEmptyHint')}
          action={t('goToCatalog')}
          onAction={() => router.navigate('/catalog')}
        />
      </SafeAreaView>
    );
  }

  const contentWidth = Math.min(width, 720);
  const problems = quote?.problems ?? [];
  const lineProblem = (variantId: number) => problems.find((p) => p.variantId === variantId);
  const minOrder = problems.find((p) => p.code === 'min_order');
  const blocking = problems.some((p) => p.code === 'unavailable' || p.code === 'out_of_stock' || p.code === 'min_order');

  const freeFrom = quote?.freeDeliveryFrom ?? config?.freeDeliveryFrom ?? 0;
  const afterDiscount = quote ? quote.subtotal - quote.discount : 0;
  const remaining = Math.max(0, freeFrom - afterDiscount);
  const progress = freeFrom ? Math.min(1, afterDiscount / freeFrom) : 1;

  const promoError = quote?.promo.error
    ? t(`error_${quote.promo.error}` as 'error_promo_not_found', { sum: money(quote.promo.minTotal ?? 0) })
    : null;

  const goCheckout = () => {
    if (customer) router.push('/checkout');
    else router.push({ pathname: '/login', params: { next: 'checkout' } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { width: contentWidth }]} keyboardShouldPersistTaps="handled">
        <T variant="h1" accessibilityRole="header">{t('cartTitle')}</T>

        {/* До бесплатной доставки */}
        {quote && freeFrom ? (
          <View style={styles.freeBox}>
            <View style={styles.freeRow}>
              <Ionicons name={remaining ? 'car-outline' : 'checkmark-circle'} size={20} color={colors.leafInk} />
              <T variant="bodyBold" style={{ flex: 1 }}>
                {remaining ? t('toFreeDelivery', { sum: money(remaining) }) : t('freeDeliveryReached')}
              </T>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
          </View>
        ) : null}

        {cart.map((item) => {
          const problem = lineProblem(item.variantId);
          const line = quote?.lines.find((l) => l.variantId === item.variantId);
          const price = line?.price ?? item.price;
          return (
            <View key={item.variantId} style={styles.line}>
              <Pressable
                onPress={() => router.push({ pathname: '/product/[slug]', params: { slug: item.slug } })}
                accessibilityRole="link"
                accessibilityLabel={pick(item.name)}
                style={styles.lineArt}
              >
                <ProductArt image={item.image} kind={item.kind} color={item.color.hex} size={70} rounded={radius.md} />
              </Pressable>
              <View style={styles.lineBody}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={2}>{pick(item.name)}</Text>
                  <Pressable onPress={() => removeFromCart(item.variantId)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('remove')}>
                    <Ionicons name="close" size={20} color={colors.inkSoft} />
                  </Pressable>
                </View>
                <View style={styles.lineMeta}>
                  <View style={[styles.swatch, { backgroundColor: item.color.hex }]} />
                  <T variant="small">{pick(item.color.name)} · {item.size} ({ageForSize(lang, item.size, item.kind)})</T>
                </View>
                {problem ? (
                  <T variant="small" color={colors.coralInk}>
                    {problem.code === 'unavailable' || problem.available === 0 ? t('unavailable') : t('onlyAvailable', { count: problem.available ?? 0 })}
                  </T>
                ) : null}
                <View style={styles.lineBottom}>
                  <Text style={styles.linePrice}>{money(price * item.quantity)}</Text>
                  <QuantityStepper compact value={item.quantity} onChange={(q) => setQuantity(item.variantId, q)}
                    max={problem?.code === 'out_of_stock' && problem.available ? Math.max(problem.available, 1) : 20} />
                </View>
              </View>
            </View>
          );
        })}

        {/* Промокод */}
        <Card style={styles.promoCard}>
          <T variant="label">{t('promoCode')}</T>
          <View style={styles.promoRow}>
            <TextInput
              value={promoText}
              onChangeText={(v) => setPromoText(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="SALOM10"
              placeholderTextColor="#A8917D"
              style={styles.promoInput}
              accessibilityLabel={t('promoCode')}
              onSubmitEditing={() => setPromoCode(promoText.trim())}
            />
            {promoCode && quote?.promo.applied ? (
              <Button small variant="ghost" title="✕" onPress={() => { setPromoCode(''); setPromoText(''); }} />
            ) : (
              <Button small variant="secondary" title={t('apply')} onPress={() => setPromoCode(promoText.trim())} disabled={!promoText.trim()} />
            )}
          </View>
          {quote?.promo.applied ? <T variant="small" color={colors.leafInk}>{t('promoApplied')}</T> : null}
          {promoError ? <T variant="small" color={colors.coralInk}>{promoError}</T> : null}
        </Card>

        {/* Итог */}
        <Card>
          <Row label={t('subtotal')} value={quote ? money(quote.subtotal) : '…'} />
          {quote?.discount ? <Row label={t('discount')} value={`−${money(quote.discount)}`} valueColor={colors.coralInk} /> : null}
          <Row label={t('delivery')} value={t('deliveryFromCheckout')} />
          <Divider />
          <Row bold label={t('total')} value={quote ? money(quote.subtotal - quote.discount) : '…'} />
          {minOrder ? <T variant="small" color={colors.coralInk}>{t('minOrder', { sum: money(minOrder.minTotal ?? 0) })}</T> : null}
          {error ? <T variant="small" color={colors.coralInk}>{t(error.code === 'network' ? 'error_network' : 'error_unknown')}</T> : null}
          <Button title={t('checkout')} icon="arrow-forward" onPress={goCheckout} disabled={!quote || blocking || loading} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  content: { alignSelf: 'center', padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  freeBox: { backgroundColor: colors.leafSoft, borderRadius: radius.md, padding: space.md, gap: space.sm },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.paper, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.leaf },
  line: { flexDirection: 'row', gap: space.md, backgroundColor: colors.paper, borderRadius: radius.lg, padding: space.sm },
  lineArt: { width: 92 },
  lineBody: { flex: 1, gap: 4 },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  lineName: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  lineMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(74,42,20,0.2)' },
  lineBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' },
  linePrice: { fontFamily: fonts.heavy, fontSize: 16, color: colors.ink },
  promoCard: { gap: space.sm },
  promoRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  promoInput: {
    flex: 1, minHeight: 44, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: space.md, fontFamily: fonts.heavy, fontSize: 15, color: colors.ink, letterSpacing: 1,
  },
});
