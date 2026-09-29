import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/lib/store';
import { colors, fonts } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon = (active: IconName, idle: IconName) =>
  function TabIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : idle} size={size} color={color as string} />;
  };

export default function TabLayout() {
  const { t, cartCount } = useStore();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tealInk,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 15 },
        // Выше стандартной (49): подписи Nunito не помещаются по высоте.
        // Отступ снизу под системную полосу панель добавляет сама.
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.line, height: 62 + insets.bottom },
        tabBarBadgeStyle: { backgroundColor: colors.coralInk, color: colors.paper, fontFamily: fonts.heavy, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabHome'), tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="catalog" options={{ title: t('tabCatalog'), tabBarIcon: icon('grid', 'grid-outline') }} />
      <Tabs.Screen name="favorites" options={{ title: t('tabFavorites'), tabBarIcon: icon('heart', 'heart-outline') }} />
      <Tabs.Screen
        name="cart"
        options={{ title: t('tabCart'), tabBarIcon: icon('bag-handle', 'bag-handle-outline'), tabBarBadge: cartCount || undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: t('tabProfile'), tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}
