import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/brand';
import { Badges, FavoriteButton, Price, ProductArt } from '@/components/product';
import { Button, T } from '@/components/ui';
import { imageUrl } from '@/lib/api';
import { ageForSize } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import type { ProductDetails } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { colors, fonts, radius, space } from '@/theme';

const bySize = (a: string, b: string) => Number(a) - Number(b);

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, pick, lang, money, addToCart, cart, config } = useStore();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { data: product, error, loading, reload } = useApi<ProductDetails>(`/api/products/${encodeURIComponent(slug)}`);

  const [colorCode, setColorCode] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [sizeHint, setSizeHint] = useState(false);
  const [page, setPage] = useState(0);

  // Цвет по умолчанию — первый, в котором что-то есть в наличии
  useEffect(() => {
    if (!product || colorCode) return;
    const inStock = product.colors.find((c) => product.variants.some((v) => v.colorCode === c.code && v.stock > 0));
    setColorCode((inStock ?? product.colors[0])?.code ?? null);
  }, [product, colorCode]);

  const sizes = useMemo(() => {
    if (!product || !colorCode) return [];
    return product.variants.filter((v) => v.colorCode === colorCode).sort((a, b) => bySize(a.size, b.size));
  }, [product, colorCode]);

  // Если размер в новом цвете закончился — сбрасываем выбор
  useEffect(() => {
    if (size && !sizes.some((v) => v.size === size && v.stock > 0)) setSize(null);
    const available = sizes.filter((v) => v.stock > 0);
    if (!size && available.length === 1) setSize(available[0].size);
  }, [sizes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!product) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 56 }]}>
        <Stack.Screen options={{ headerTransparent: false, title: '' }} />
        {loading ? <ActivityIndicator color={colors.tealInk} /> : (
          <EmptyState
            title={t(error?.code === 'network' ? 'error_network' : error?.code === 'product_not_found' ? 'nothingFound' : 'error_unknown')}
            action={t('retry')}
            onAction={reload}
          />
        )}
      </View>
    );
  }

  const color = product.colors.find((c) => c.code === colorCode) ?? product.colors[0];
  const variant = sizes.find((v) => v.size === size) ?? null;
  const inCart = variant ? cart.some((i) => i.variantId === variant.id) : false;
  const artSize = Math.min(width, 520);

  const add = () => {
    if (!variant || !color) {
      setSizeHint(true);
      return;
    }
    if (inCart) {
      router.navigate('/cart');
      return;
    }
    addToCart({
      variantId: variant.id,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      kind: product.kind,
      size: variant.size,
      color: { hex: color.hex, name: color.name },
      image: product.images[0] ?? null,
      price: product.price,
    });
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerRight: () => <FavoriteButton productId={product.id} /> }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View style={[styles.gallery, { width: artSize }]}>
          {product.images.length ? (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / artSize))}
              >
                {product.images.map((uri) => (
                  <Image key={uri} source={{ uri: imageUrl(uri) }} style={{ width: artSize, height: artSize }} contentFit="cover" transition={150} />
                ))}
              </ScrollView>
              {product.images.length > 1 ? (
                <View style={styles.pager}>
                  {product.images.map((uri, i) => <View key={uri} style={[styles.pagerDot, i === page && styles.pagerDotActive]} />)}
                </View>
              ) : null}
            </>
          ) : (
            <ProductArt kind={product.kind} color={color?.hex ?? colors.sky} size={artSize * 0.72} rounded={0} />
          )}
          <Badges product={product} />
        </View>

        <View style={[styles.body, { width: artSize }]}>
          <View style={{ gap: 6 }}>
            <T variant="h1">{pick(product.name)}</T>
            <Price price={product.price} oldPrice={product.oldPrice} large />
          </View>

          {/* Цвет */}
          <View style={styles.block}>
            <T variant="label">{t('color')}: <Text style={styles.selected}>{pick(color?.name)}</Text></T>
            <View style={styles.colors}>
              {product.colors.map((c) => {
                const active = c.code === colorCode;
                const any = product.variants.some((v) => v.colorCode === c.code && v.stock > 0);
                return (
                  <Pressable
                    key={c.code}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: !any }}
                    accessibilityLabel={pick(c.name)}
                    onPress={() => setColorCode(c.code)}
                    style={[styles.colorRing, active && styles.colorRingActive]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: c.hex }, !any && { opacity: 0.35 }]} />
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Размер */}
          <View style={styles.block}>
            <View style={styles.sizeHeader}>
              <T variant="label">{t('size')}</T>
              <Pressable onPress={() => router.push('/size-guide')} hitSlop={8} accessibilityRole="link" style={styles.guideLink}>
                <Ionicons name="resize-outline" size={16} color={colors.tealInk} />
                <Text style={styles.guideText}>{t('sizeGuide')}</Text>
              </Pressable>
            </View>
            <View style={styles.sizes}>
              {sizes.map((v) => {
                const active = v.size === size;
                const soldOut = v.stock <= 0;
                return (
                  <Pressable
                    key={v.id}
                    disabled={soldOut}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: soldOut }}
                    accessibilityLabel={`${v.size}, ${ageForSize(lang, v.size, product.kind)}${soldOut ? `, ${t('outOfStock')}` : ''}`}
                    onPress={() => { setSize(v.size); setSizeHint(false); }}
                    style={[styles.size, active && styles.sizeActive, soldOut && styles.sizeSoldOut]}
                  >
                    <Text style={[styles.sizeText, active && styles.sizeTextActive, soldOut && styles.sizeTextSoldOut]}>{v.size}</Text>
                    <Text style={[styles.sizeAge, active && styles.sizeTextActive]}>{ageForSize(lang, v.size, product.kind)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {sizeHint && !variant ? <T variant="bodyBold" color={colors.coralInk}>{t('chooseSize')}</T> : null}
            {variant && variant.stock <= 3 ? <T variant="bodyBold" color={colors.coralInk}>{t('onlyLeft', { count: variant.stock })}</T> : null}
          </View>

          <View style={styles.info}>
            {pick(product.description) ? <InfoBlock title={t('description')} text={pick(product.description)} /> : null}
            {pick(product.material) ? <InfoBlock title={t('material')} text={pick(product.material)} icon="leaf-outline" /> : null}
            <InfoBlock title={t('care')} text={t('careText')} icon="water-outline" />
            <InfoBlock
              title={t('deliveryInfo')}
              text={`${t('deliveryInfoText', { sum: money(config?.freeDeliveryFrom ?? 500000) })} ${t('returnInfo')}`}
              icon="car-outline"
            />
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.md }]}>
        <View style={{ width: artSize - space.lg * 2 }}>
          <Button
            title={inCart ? t('inCart') : t('addToCart')}
            icon={inCart ? 'checkmark-circle' : 'bag-add-outline'}
            variant={inCart ? 'secondary' : 'primary'}
            disabled={!product.inStock}
            onPress={add}
          />
        </View>
      </View>
    </View>
  );
}

function InfoBlock({ title, text, icon }: { title: string; text: string; icon?: 'leaf-outline' | 'water-outline' | 'car-outline' }) {
  return (
    <View style={styles.infoBlock}>
      <View style={styles.infoTitle}>
        {icon ? <Ionicons name={icon} size={18} color={colors.tealInk} /> : null}
        <T variant="h3">{title}</T>
      </View>
      <T variant="body">{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', backgroundColor: colors.cream },
  gallery: { alignSelf: 'center' },
  pager: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  pagerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' },
  pagerDotActive: { backgroundColor: colors.paper, width: 20 },
  body: { alignSelf: 'center', padding: space.lg, gap: space.xl },
  block: { gap: space.sm },
  selected: { color: colors.ink },
  colors: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  colorRing: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  colorRingActive: { borderColor: colors.tealInk },
  colorDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(74,42,20,0.2)' },
  sizeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  guideLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  guideText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.tealInk },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  size: {
    minWidth: 76, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md - 4, borderWidth: 1.5,
    borderColor: colors.line, backgroundColor: colors.paper, alignItems: 'center',
  },
  sizeActive: { borderColor: colors.tealInk, backgroundColor: colors.tealInk },
  sizeSoldOut: { backgroundColor: colors.sand, borderColor: colors.sand },
  sizeText: { fontFamily: fonts.heavy, fontSize: 16, color: colors.ink },
  sizeTextActive: { color: colors.paper },
  sizeTextSoldOut: { color: colors.inkSoft, textDecorationLine: 'line-through' },
  sizeAge: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.inkSoft },
  info: { gap: space.lg },
  infoBlock: { gap: 4 },
  infoTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: space.md,
    backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line,
  },
});
