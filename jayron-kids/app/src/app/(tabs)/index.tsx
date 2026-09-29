import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Emblem, HeartIcon, RainbowIcon, SproutIcon, SunIcon, Wordmark } from '@/components/brand';
import { artBackground, GarmentArt } from '@/components/GarmentArt';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ProductCard } from '@/components/product';
import { Button, SectionHeader, T } from '@/components/ui';
import { DEMO_MODE } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { Category, Product } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { colors, fonts, radius, shadow, space } from '@/theme';

type ProductList = { items: Product[]; total: number };

export default function HomeScreen() {
  const { t, pick, money, config } = useStore();
  const { width } = useWindowDimensions();
  const categories = useApi<Category[]>('/api/categories');
  const fresh = useApi<ProductList>('/api/products?new=1&sort=new&limit=10');
  const hits = useApi<ProductList>('/api/products?hit=1&limit=6');

  const refreshing = categories.loading || fresh.loading || hits.loading;
  const refresh = () => { categories.reload(); fresh.reload(); hits.reload(); };
  const offline = !categories.data && categories.error?.code === 'network';

  const contentWidth = Math.min(width, 720);
  const gridCard = (contentWidth - space.lg * 2 - space.md) / 2;
  const openCatalog = (params: Record<string, string> = {}) => router.push({ pathname: '/catalog', params });

  const values = [
    { icon: <SproutIcon size={34} />, label: t('valueSoft') },
    { icon: <HeartIcon size={34} />, label: t('valueAll') },
    { icon: <RainbowIcon size={34} />, label: t('valueAdventure') },
    { icon: <SunIcon size={34} />, label: t('valueTomorrow') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { width: contentWidth }]}
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing && Boolean(categories.data)} onRefresh={refresh} tintColor={colors.tealInk} />}
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <Emblem size={42} />
            <Wordmark size={22} />
          </View>
          <LanguageSwitch />
        </View>

        {DEMO_MODE ? (
          <View style={styles.demo}>
            <Ionicons name="information-circle-outline" size={20} color={colors.ink} />
            <T variant="small" color={colors.ink} style={{ flex: 1 }}>{t('demoBanner')}</T>
          </View>
        ) : null}

        <Pressable style={styles.search} onPress={() => openCatalog({ focus: '1' })} accessibilityRole="search">
          <Ionicons name="search" size={20} color={colors.inkSoft} />
          <Text style={styles.searchText}>{t('searchPlaceholder')}</Text>
        </Pressable>

        {/* Главный баннер */}
        <View style={styles.hero}>
          <View style={styles.heroSun}><SunIcon size={56} /></View>
          <View style={styles.heroHeart}><HeartIcon size={22} /></View>
          <View style={styles.heroText}>
            <Text style={styles.heroTagline}>{t('tagline')}</Text>
            <T variant="h1">{t('heroTitle')}</T>
            <T variant="body" color={colors.ink}>{t('brandMessage')}</T>
            <Button title={t('heroCta')} variant="sunny" small onPress={() => openCatalog()} style={styles.heroButton} />
          </View>
          <Emblem size={Math.min(120, contentWidth * 0.28)} />
        </View>

        {offline ? (
          <View style={styles.offline}>
            <Ionicons name="cloud-offline-outline" size={22} color={colors.coralInk} />
            <T variant="bodyBold" style={{ flex: 1 }}>{t('error_network')}</T>
            <Button title={t('retry')} small variant="secondary" onPress={refresh} />
          </View>
        ) : null}

        {/* Ценности бренда */}
        <View style={styles.values}>
          {values.map((v) => (
            <View key={v.label} style={styles.value}>
              {v.icon}
              <Text style={styles.valueText}>{v.label}</Text>
            </View>
          ))}
        </View>

        {/* Категории */}
        <SectionHeader title={t('categories')} action={t('seeAll')} onAction={() => openCatalog()} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
          {(categories.data ?? []).map((c) => (
            <Pressable key={c.id} style={styles.category} onPress={() => openCatalog({ category: c.slug })}
              accessibilityRole="link" accessibilityLabel={pick(c.name)}>
              <View style={[styles.categoryArt, { backgroundColor: artBackground(c.color) }]}>
                <GarmentArt kind={c.kind} color={c.color} size={56} heart={false} />
              </View>
              <Text style={styles.categoryText} numberOfLines={2}>{pick(c.name)}</Text>
            </Pressable>
          ))}
          {!categories.data && !offline ? [0, 1, 2, 3].map((i) => <View key={i} style={[styles.categoryArt, styles.placeholder]} />) : null}
        </ScrollView>

        {/* Новинки */}
        <SectionHeader title={t('newArrivals')} action={t('seeAll')} onAction={() => openCatalog({ sort: 'new', new: '1' })} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
          {(fresh.data?.items ?? []).map((p) => <ProductCard key={p.id} product={p} width={164} />)}
          {!fresh.data && !offline ? [0, 1].map((i) => <View key={i} style={[styles.cardPlaceholder, styles.placeholder]} />) : null}
        </ScrollView>

        {/* Бесплатная доставка */}
        {config ? (
          <View style={styles.delivery}>
            <Ionicons name="car-outline" size={28} color={colors.leafInk} />
            <T variant="bodyBold" style={{ flex: 1 }}>{t('freeDeliveryBanner', { sum: money(config.freeDeliveryFrom) })}</T>
          </View>
        ) : null}

        {/* Хиты */}
        <SectionHeader title={t('bestsellers')} action={t('seeAll')} onAction={() => openCatalog({ hit: '1' })} />
        <View style={styles.grid}>
          {(hits.data?.items ?? []).map((p) => <ProductCard key={p.id} product={p} width={gridCard} />)}
        </View>

        <View style={styles.footer}>
          <SproutIcon size={28} />
          <T variant="small" center>{t('madeInUz')}</T>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  scroll: { flex: 1 },
  content: { alignSelf: 'center', paddingBottom: space.xxl, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  search: {
    marginHorizontal: space.lg, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.paper,
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderWidth: 1, borderColor: colors.line,
  },
  searchText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.inkSoft },
  hero: {
    marginHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.skySoft, padding: space.lg,
    flexDirection: 'row', alignItems: 'center', gap: space.md, overflow: 'hidden',
  },
  heroSun: { position: 'absolute', right: -8, top: -10, opacity: 0.9 },
  heroHeart: { position: 'absolute', left: '58%', bottom: 14 },
  heroText: { flex: 1, gap: 6 },
  heroTagline: { fontFamily: fonts.headingSemi, fontSize: 13, color: colors.tealInk, letterSpacing: 0.5 },
  heroButton: { alignSelf: 'flex-start', marginTop: 6 },
  demo: {
    marginHorizontal: space.lg, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md,
    backgroundColor: colors.sunnySoft, flexDirection: 'row', alignItems: 'center', gap: space.sm,
  },
  offline: {
    marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
  },
  values: { flexDirection: 'row', marginHorizontal: space.lg, backgroundColor: colors.paper, borderRadius: radius.lg, paddingVertical: space.md, ...shadow },
  value: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  valueText: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 14, color: colors.ink, textAlign: 'center' },
  hList: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: 6 },
  category: { width: 84, alignItems: 'center', gap: 6 },
  categoryArt: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  categoryText: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 15, color: colors.ink, textAlign: 'center' },
  placeholder: { backgroundColor: colors.sand },
  cardPlaceholder: { width: 164, height: 250, borderRadius: radius.lg },
  delivery: {
    marginHorizontal: space.lg, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.leafSoft,
    flexDirection: 'row', alignItems: 'center', gap: space.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.lg },
  footer: { alignItems: 'center', gap: 4, paddingTop: space.md },
});
