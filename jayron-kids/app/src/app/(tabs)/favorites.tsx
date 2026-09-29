import { router } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, HeartIcon } from '@/components/brand';
import { ProductCard } from '@/components/product';
import { T } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { Product } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { colors, space } from '@/theme';

export default function FavoritesScreen() {
  const { t, favorites } = useStore();
  const { width } = useWindowDimensions();
  const ids = [...favorites].sort((a, b) => a - b).join(',');
  const { data, loading, error, reload } = useApi<{ items: Product[] }>(ids ? `/api/products?ids=${ids}&limit=100` : null);

  const columns = width >= 700 ? 3 : 2;
  const contentWidth = Math.min(width, 960);
  const cardWidth = (contentWidth - space.lg * 2 - space.md * (columns - 1)) / columns;
  // Порядок — как добавляли: последние сверху
  const items = favorites
    .map((id) => data?.items.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        key={columns}
        data={ids ? items : []}
        keyExtractor={(p) => String(p.id)}
        numColumns={columns}
        contentContainerStyle={[styles.content, { width: contentWidth }]}
        columnWrapperStyle={{ gap: space.md }}
        renderItem={({ item }) => <ProductCard product={item} width={cardWidth} />}
        ListHeaderComponent={<T variant="h1" accessibilityRole="header">{t('tabFavorites')}</T>}
        ListEmptyComponent={
          ids && loading ? <ActivityIndicator color={colors.tealInk} style={{ marginTop: 48 }} />
            : ids && error ? <EmptyState title={t('error_network')} action={t('retry')} onAction={reload} />
              : (
                <EmptyState
                  icon={<HeartIcon size={88} />}
                  title={t('tabFavorites')}
                  hint={t('cartEmptyHint')}
                  action={t('goToCatalog')}
                  onAction={() => router.navigate('/catalog')}
                />
              )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  content: { alignSelf: 'center', padding: space.lg, gap: space.md },
});
