import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Emblem } from '@/components/brand';
import { Button, Field, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { displayPhone, formatLocalPhone, fullPhone, localDigits } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Customer } from '@/lib/types';
import { colors, fonts, radius, space } from '@/theme';

type CodeResponse = { phone: string; resendIn: number; length: number; debugCode?: string };

export default function LoginScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { t, lang, signIn } = useStore();
  const [digits, setDigits] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [codeLength, setCodeLength] = useState(5);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const describe = (e: unknown) => {
    const err = e as ApiError;
    const key = `error_${err.code}` as 'error_unknown';
    const text = t(key, { seconds: err.details?.retryIn ?? 60 });
    return text === key ? t('error_unknown') : text;
  };

  const requestCode = async () => {
    if (digits.length !== 9) {
      setError(t('error_invalid_phone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<CodeResponse>('POST', '/api/auth/request-code', { body: { phone: fullPhone(digits), language: lang } });
      setStep('code');
      setCode('');
      setCodeLength(res.length);
      setSeconds(res.resendIn);
      setDebugCode(res.debugCode ?? null);
      setTimeout(() => codeRef.current?.focus(), 200);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'otp_too_soon') {
        setStep('code');
        setSeconds(err.details?.retryIn ?? 60);
      }
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== codeLength || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; customer: Customer }>('POST', '/api/auth/verify', {
        body: { phone: fullPhone(digits), code: value, language: lang },
      });
      await signIn(res.token, res.customer);
      if (next === 'checkout') router.replace('/checkout');
      else if (router.canGoBack()) router.back();
      else router.replace('/profile');
    } catch (e) {
      setError(describe(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Emblem size={96} />
        <T variant="h1" center>{t('loginTitle')}</T>

        {step === 'phone' ? (
          <>
            <T variant="body" center color={colors.inkSoft}>{t('loginIntro')}</T>
            <Field
              label={t('phone')}
              prefix="+998"
              value={formatLocalPhone(digits)}
              onChangeText={(v) => { setDigits(localDigits(v)); setError(null); }}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              placeholder="90 123 45 67"
              maxLength={12}
              autoFocus
              error={error}
              onSubmitEditing={requestCode}
              containerStyle={styles.field}
            />
            <Button title={t('getCode')} onPress={requestCode} loading={busy} disabled={digits.length !== 9} style={styles.field} />
          </>
        ) : (
          <>
            <T variant="body" center color={colors.inkSoft}>{t('codeSent', { phone: displayPhone(digits) })}</T>
            {debugCode ? (
              <Pressable style={styles.debug} onPress={() => { setCode(debugCode); verify(debugCode); }} accessibilityRole="button">
                <Text style={styles.debugText}>{t('debugCode', { code: debugCode })}</Text>
              </Pressable>
            ) : null}
            <Field
              ref={codeRef}
              label={t('code')}
              value={code}
              onChangeText={(v) => {
                const clean = v.replace(/\D/g, '').slice(0, codeLength);
                setCode(clean);
                setError(null);
                if (clean.length === codeLength) verify(clean);
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={codeLength}
              placeholder={'•'.repeat(codeLength)}
              style={styles.codeInput}
              error={error}
              containerStyle={styles.field}
            />
            <Button title={t('confirm')} onPress={() => verify()} loading={busy} disabled={code.length !== codeLength} style={styles.field} />
            <View style={styles.links}>
              {seconds > 0 ? (
                <T variant="small">{t('resendIn', { seconds })}</T>
              ) : (
                <Pressable onPress={requestCode} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>{t('resend')}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => { setStep('phone'); setError(null); }} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>{t('changePhone')}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: space.xl, gap: space.lg, alignItems: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' },
  field: { alignSelf: 'stretch' },
  codeInput: { fontFamily: fonts.heavy, fontSize: 24, letterSpacing: 10, textAlign: 'center' },
  debug: { backgroundColor: colors.sunnySoft, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.lg },
  debugText: { fontFamily: fonts.bodyBold, color: colors.ink, fontSize: 14 },
  links: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.md },
  link: { fontFamily: fonts.bodyBold, color: colors.tealInk, fontSize: 14 },
});
