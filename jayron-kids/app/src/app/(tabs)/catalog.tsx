import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/brand';
import { ProductCard } from '@/components/product';
import { Button, Chip, T } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { Category, Product } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { colors, fonts, radius, space } from '@/theme';

type Sort = 'popular' | 'new' | 'price_asc' | 'price_desc';
type Flag = '' | 'new' | 'hit' | 'sale';
type Params = { category?: string; sort?: string; new?: string; hit?: string; sale?: string; focus?: string; gender?: string };

const flagFrom = (p: Params): Flag => (p.new === '1' ? 'new' : p.hit === '1' ? 'hit' : p.sale === '1' ? 'sale' : '');

export default function CatalogScreen() {
  const params = useLocalSearchParams<Params>();
  const { t, pick } = useStore();
  const { width } = useWindowDimensions();
  const searchRef = useRef<TextInput>(null);

  const [category, setCategory] = useState(params.category ?? '');
  const [gender, setGender] = useState<'' | 'boy' | 'girl'>(params.gender === 'boy' || params.gender === 'girl' ? params.gender : '');
  const [sort, setSort] = useState<Sort>((params.sort as Sort) || 'popular');
  const [flag, setFlag] = useState<Flag>(flagFrom(params));
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  // Переход с главной с новыми параметрами
  useEffect(() => {
    setCategory(params.category ?? '');
    setFlag(flagFrom(params));
    if (params.sort) setSort(params.sort as Sort);
    if (params.focus === '1') setTimeout(() => searchRef.current?.focus(), 150);
  }, [params.category, params.sort, params.new, params.hit, params.sale, params.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const categories = useApi<Category[]>('/api/categories');
  const path = useMemo(() => {
    const q = new URLSearchParams({ sort, limit: '100' });
    if (category) q.set('category', category);
    if (gender) q.set('gender', gender);
    if (flag) q.set(flag, '1');
    if (query) q.set('q', query);
    return `/api/products?${q}`;
  }, [category, gender, sort, flag, query]);
  const products = useApi<{ items: Product[]; total: number }>(path);

  const columns = width >= 700 ? 3 : 2;
  const contentWidth = Math.min(width, 960);
  const cardWidth = (contentWidth - space.lg * 2 - space.md * (columns - 1)) / columns;
  const filtered = Boolean(category || gender || flag || query);
  const reset = () => { setCategory(''); setGender(''); setFlag(''); setText(''); setQuery(''); setSort('popular'); };

  const sorts: [Sort, string][] = [['popular', t('sortPopular')], ['new', t('sortNew')], ['price_asc', t('sortCheap')], ['price_desc', t('sortExpensive')]];
  const flags: [Flag, string][] = [['new', t('badgeNew')], ['hit', t('badgeHit')], ['sale', t('sale')]];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={[styles.top, { width: contentWidth }]}>
        <T variant="h1" accessibilityRole="header" style={styles.title}>{t('tabCatalog')}</T>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.inkSoft} />
          <TextInput
            ref={searchRef}
            value={text}
            onChangeText={setText}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor="#A8917D"
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel={t('searchPlaceholder')}
          />
          {text ? (
            <Pressable onPress={() => setText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('close')}>
              <Ionicons name="close-circle" size={20} color={colors.inkSoft} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('all')} active={!category} onPress={() => setCategory('')} />
          {(categories.data ?? []).map((c) => (
            <Chip key={c.id} label={pick(c.name)} active={category === c.slug} onPress={() => setCategory(category === c.slug ? '' : c.slug)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('boys')} color={colors.sky} active={gender === 'boy'} onPress={() => setGender(gender === 'boy' ? '' : 'boy')} />
          <Chip label={t('girls')} color={colors.coral} active={gender === 'girl'} onPress={() => setGender(gender === 'girl' ? '' : 'girl')} />
          {flags.map(([code, label]) => (
            <Chip key={code} label={label} color={colors.sunny} active={flag === code} onPress={() => setFlag(flag === code ? '' : code)} />
          ))}
          <View style={styles.separator} />
          {sorts.map(([code, label]) => (
            <Chip key={code} label={label} color={colors.leaf} active={sort === code} onPress={() => setSort(code)} />
          ))}
        </ScrollView>
      </View>

      <FlatList
        key={columns}
        data={products.data?.items ?? []}
        keyExtractor={(p) => String(p.id)}
        numColumns={columns}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { width: contentWidth }]}
        columnWrapperStyle={{ gap: space.md }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <ProductCard product={item} width={cardWidth} />}
        ListHeaderComponent={products.data ? (
          <T variant="small" style={styles.count}>{t('productsCount', { count: products.data.total })}</T>
        ) : null}
        ListEmptyComponent={
          products.loading ? <ActivityIndicator color={colors.tealInk} style={{ marginTop: 48 }} />
            : products.error ? (
              <EmptyState title={t(products.error.code === 'network' ? 'error_network' : 'error_unknown')}
                action={t('retry')} onAction={products.reload} />
            ) : (
              <EmptyState title={t('nothingFound')} hint={t('nothingFoundHint')}
                action={filtered ? t('resetFilters') : undefined} onAction={filtered ? reset : undefined} />
            )
        }
        ListFooterComponent={filtered && products.data?.items.length ? (
          <Button title={t('resetFilters')} variant="ghost" small onPress={reset} style={{ alignSelf: 'center', marginTop: space.lg }} />
        ) : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  top: { alignSelf: 'center', gap: space.sm, paddingTop: space.sm, paddingBottom: space.sm },
  title: { paddingHorizontal: space.lg },
  search: {
    marginHorizontal: space.lg, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.paper,
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderWidth: 1, borderColor: colors.line,
  },
  searchInput: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink, paddingVertical: 10 },
  chips: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
  separator: { width: 1, height: 24, backgroundColor: colors.line, marginHorizontal: 2 },
  list: { flex: 1 },
  listContent: { alignSelf: 'center', paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md },
  count: { marginBottom: 2 },
});
