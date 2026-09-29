/** Карточка товара, изображение товара, цена и счётчик количества. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { imageUrl } from '@/lib/api';
import { discountPercent } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { GarmentKind, Product } from '@/lib/types';
import { colors, fonts, radius, shadow, space } from '@/theme';
import { artBackground, GarmentArt } from './GarmentArt';

/** Фото товара, а пока фото нет — рисунок изделия в выбранном цвете. */
export function ProductArt({
  image, kind, color, size, style, rounded = radius.lg,
}: { image?: string | null; kind: GarmentKind; color: string; size: number; style?: StyleProp<ViewStyle>; rounded?: number }) {
  if (image) {
    return (
      <Image
        source={{ uri: imageUrl(image) }}
        style={[{ width: '100%', aspectRatio: 1, borderRadius: rounded, backgroundColor: colors.sand }, style as any]}
        contentFit="cover"
        transition={150}
        accessible={false}
      />
    );
  }
  return (
    <View style={[styles.art, { backgroundColor: artBackground(color), borderRadius: rounded }, style]}>
      <GarmentArt kind={kind} color={color} size={size} />
    </View>
  );
}

export function Price({ price, oldPrice, large }: { price: number; oldPrice?: number | null; large?: boolean }) {
  const { money } = useStore();
  const percent = discountPercent(price, oldPrice ?? null);
  return (
    <View style={styles.priceRow}>
      <Text style={[styles.price, large && styles.priceLarge, percent ? { color: colors.coralInk } : null]}>{money(price)}</Text>
      {percent ? <Text style={[styles.oldPrice, large && { fontSize: 15 }]}>{money(oldPrice!)}</Text> : null}
    </View>
  );
}

export function Badges({ product }: { product: Pick<Product, 'isNew' | 'isHit' | 'price' | 'oldPrice'> }) {
  const { t } = useStore();
  const percent = discountPercent(product.price, product.oldPrice);
  return (
    <View style={styles.badges}>
      {percent ? <Text style={[styles.badge, styles.badgeSale]}>−{percent}%</Text> : null}
      {product.isNew ? <Text style={[styles.badge, styles.badgeNew]}>{t('badgeNew')}</Text> : null}
      {product.isHit ? <Text style={[styles.badge, styles.badgeHit]}>{t('badgeHit')}</Text> : null}
    </View>
  );
}

export function FavoriteButton({ productId, style }: { productId: number; style?: StyleProp<ViewStyle> }) {
  const { isFavorite, toggleFavorite, t } = useStore();
  const active = isFavorite(productId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('tabFavorites')}
      accessibilityState={{ selected: active }}
      onPress={() => toggleFavorite(productId)}
      hitSlop={8}
      style={({ pressed }) => [styles.favorite, pressed && { transform: [{ scale: 0.9 }] }, style]}
    >
      <Ionicons name={active ? 'heart' : 'heart-outline'} size={20} color={active ? colors.coralInk : colors.ink} />
    </Pressable>
  );
}

export function ProductCard({ product, width }: { product: Product; width: number }) {
  const { pick, t } = useStore();
  const color = product.colors[0]?.hex ?? colors.sky;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={pick(product.name)}
      onPress={() => router.push({ pathname: '/product/[slug]', params: { slug: product.slug } })}
      style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.92 }]}
    >
      <View>
        <ProductArt image={product.images[0]} kind={product.kind} color={color} size={width * 0.72} />
        <Badges product={product} />
        <FavoriteButton productId={product.id} style={styles.cardFavorite} />
        {!product.inStock ? (
          <View style={styles.soldOut}><Text style={styles.soldOutText}>{t('outOfStock')}</Text></View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>{pick(product.name)}</Text>
        <Price price={product.price} oldPrice={product.oldPrice} />
        <View style={styles.dots}>
          {product.colors.slice(0, 5).map((c) => (
            <View key={c.code} style={[styles.dot, { backgroundColor: c.hex }]} />
          ))}
          {product.colors.length > 5 ? <Text style={styles.moreColors}>+{product.colors.length - 5}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function QuantityStepper({
  value, onChange, max = 20, compact,
}: { value: number; onChange: (next: number) => void; max?: number; compact?: boolean }) {
  const size = compact ? 32 : 40;
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityValue={{ now: value, min: 0, max }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(e.nativeEvent.actionName === 'increment' ? Math.min(max, value + 1) : value - 1)}>
      <Pressable onPress={() => onChange(value - 1)} hitSlop={6} style={[styles.stepperButton, { width: size, height: size }]}
        accessibilityLabel="−">
        <Ionicons name={value <= 1 ? 'trash-outline' : 'remove'} size={18} color={colors.ink} />
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} hitSlop={6}
        style={[styles.stepperButton, { width: size, height: size }, value >= max && { opacity: 0.4 }]} accessibilityLabel="+">
        <Ionicons name="add" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 },
  price: { fontFamily: fonts.heavy, fontSize: 16, color: colors.ink },
  priceLarge: { fontSize: 24 },
  oldPrice: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.inkSoft, textDecorationLine: 'line-through' },
  badges: { position: 'absolute', top: 10, left: 10, gap: 4, alignItems: 'flex-start' },
  badge: { fontFamily: fonts.heavy, fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  badgeSale: { backgroundColor: colors.coralInk, color: colors.paper },
  badgeNew: { backgroundColor: colors.sunny, color: colors.ink },
  badgeHit: { backgroundColor: colors.paper, color: colors.tealInk },
  favorite: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardFavorite: { position: 'absolute', top: 8, right: 8 },
  card: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: 6, ...shadow },
  cardBody: { padding: space.sm, gap: 4 },
  cardName: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.ink, minHeight: 38 },
  dots: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 2 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(74,42,20,0.2)' },
  moreColors: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.inkSoft },
  soldOut: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.88)', borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
  },
  soldOutText: { textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cream, borderRadius: radius.pill, padding: 2 },
  stepperButton: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 28, textAlign: 'center', fontFamily: fonts.heavy, fontSize: 16, color: colors.ink },
});
