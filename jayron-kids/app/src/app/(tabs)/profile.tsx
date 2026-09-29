import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Emblem } from '@/components/brand';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button, Card, T } from '@/components/ui';
import type { ApiError } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { colors, fonts, radius, space } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function ProfileScreen() {
  const { t, customer, signOut, deleteAccount, config } = useStore();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, 720);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeAccount = async () => {
    if (!(await confirmAsync(t('deleteAccountConfirm'), t('yes'), t('no')))) return;
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (e) {
      const code = (e as ApiError).code;
      setDeleteError(t(code === 'active_orders' ? 'error_active_orders' : code === 'network' ? 'error_network' : 'error_unknown'));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { width: contentWidth }]}>
        <T variant="h1" accessibilityRole="header">{t('tabProfile')}</T>

        {customer ? (
          <Card style={styles.account}>
            <Emblem size={56} />
            <View style={{ flex: 1 }}>
              <T variant="h3">{customer.name || customer.phoneFormatted}</T>
              {customer.name ? <T variant="small">{customer.phoneFormatted}</T> : null}
            </View>
          </Card>
        ) : (
          <Card>
            <T variant="h2">{t('guestTitle')}</T>
            <T variant="body" color={colors.inkSoft}>{t('guestText')}</T>
            <Button title={t('login')} icon="log-in-outline" onPress={() => router.push('/login')} />
          </Card>
        )}

        <Card style={{ padding: 0, gap: 0 }}>
          {customer ? <MenuRow icon="receipt-outline" label={t('myOrders')} onPress={() => router.push('/orders')} /> : null}
          <MenuRow icon="resize-outline" label={t('sizeGuide')} onPress={() => router.push('/size-guide')} />
          <MenuRow icon="heart-outline" label={t('tabFavorites')} onPress={() => router.navigate('/favorites')} last />
        </Card>

        <Card>
          <T variant="h3">{t('language')}</T>
          <LanguageSwitch full />
        </Card>

        {config ? (
          <Card style={{ padding: 0, gap: 0 }}>
            <View style={styles.cardTitle}><T variant="h3">{t('support')}</T></View>
            <MenuRow icon="call-outline" label={config.supportPhone}
              onPress={() => Linking.openURL(`tel:${config.supportPhone.replace(/[^\d+]/g, '')}`)} />
            <MenuRow icon="paper-plane-outline" label={`Telegram · @${config.telegram}`}
              onPress={() => Linking.openURL(`https://t.me/${config.telegram}`)} />
            <MenuRow icon="logo-instagram" label={`Instagram · @${config.instagram}`}
              onPress={() => Linking.openURL(`https://instagram.com/${config.instagram}`)} last />
          </Card>
        ) : null}

        <View style={styles.about}>
          <Image source={require('../../../assets/logo-primary.png')} style={styles.logo} contentFit="contain"
            accessibilityLabel="Jayron Kids — Little steps, brighter tomorrows" />
          <T variant="h3" center>{t('aboutBrand')}</T>
          <T variant="body" center>{t('aboutText')}</T>
        </View>

        {customer ? (
          <>
            <Button title={t('logout')} variant="ghost" icon="log-out-outline" onPress={signOut} />
            <Pressable onPress={removeAccount} accessibilityRole="button" style={styles.delete}>
              <Text style={styles.deleteText}>{t('deleteAccount')}</Text>
            </Pressable>
            {deleteError ? <T variant="small" center color={colors.coralInk}>{deleteError}</T> : null}
          </>
        ) : null}
        <T variant="small" center>{t('version', { version: Constants.expoConfig?.version ?? '1.0.0' })}</T>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({ icon, label, onPress, last }: { icon: IconName; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && { backgroundColor: colors.cream }]}
    >
      <Ionicons name={icon} size={22} color={colors.tealInk} />
      <Text style={styles.rowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  content: { alignSelf: 'center', padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardTitle: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  about: { backgroundColor: colors.logoBg, borderRadius: radius.lg, padding: space.lg, gap: space.sm, alignItems: 'center' },
  logo: { width: 220, height: 216 },
  delete: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg },
  deleteText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.coralInk },
});
