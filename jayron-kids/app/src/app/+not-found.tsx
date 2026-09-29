import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { EmptyState } from '@/components/brand';
import { useStore } from '@/lib/store';
import { colors } from '@/theme';

export default function NotFoundScreen() {
  const { t } = useStore();
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Stack.Screen options={{ title: '' }} />
      <EmptyState title={t('nothingFound')} action={t('tabHome')} onAction={() => router.replace('/')} />
    </View>
  );
}
