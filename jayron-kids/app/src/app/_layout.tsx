import {
  Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black,
} from '@expo-google-fonts/nunito';
import { Quicksand_600SemiBold, Quicksand_700Bold } from '@expo-google-fonts/quicksand';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfirmHost } from '@/components/ConfirmHost';
import { StoreProvider, useStore } from '@/lib/store';
import { colors, headingFont } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Navigator() {
  const { ready, t, lang } = useStore();
  const [fontsLoaded, fontError] = useFonts({
    Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black,
    Quicksand_600SemiBold, Quicksand_700Bold,
  });
  const loaded = ready && (fontsLoaded || Boolean(fontError));

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.cream },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: headingFont(lang), fontSize: 18, color: colors.ink },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.cream },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[slug]" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="checkout" options={{ title: t('checkoutTitle') }} />
      <Stack.Screen name="orders/index" options={{ title: t('myOrders') }} />
      <Stack.Screen name="orders/[id]" options={{ title: '' }} />
      <Stack.Screen name="login" options={{ presentation: 'modal', title: t('loginTitle') }} />
      <Stack.Screen name="size-guide" options={{ presentation: 'modal', title: t('sizeGuide') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Navigator />
        <ConfirmHost />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
