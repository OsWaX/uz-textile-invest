import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useStore } from '@/lib/store';
import type { Lang } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

const LANGS: { code: Lang; label: string; full: string }[] = [
  { code: 'uz', label: 'UZ', full: 'O‘zbekcha' },
  { code: 'ru', label: 'RU', full: 'Русский' },
];

/** Переключатель языка интерфейса: узбекский (латиница) и русский. */
export function LanguageSwitch({ full = false }: { full?: boolean }) {
  const { lang, setLang } = useStore();
  return (
    <View style={[styles.wrap, full && styles.wrapFull]} accessibilityRole="radiogroup">
      {LANGS.map((l) => {
        const active = l.code === lang;
        return (
          <Pressable
            key={l.code}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={l.full}
            onPress={() => setLang(l.code)}
            style={[styles.option, full && styles.optionFull, active && styles.active]}
          >
            <Text style={[styles.text, active && styles.textActive]}>{full ? l.full : l.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: colors.paper, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: colors.line },
  wrapFull: { alignSelf: 'stretch' },
  option: { minWidth: 40, minHeight: 34, paddingHorizontal: 10, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  optionFull: { flex: 1, minHeight: 42 },
  active: { backgroundColor: colors.tealInk },
  text: { fontFamily: fonts.heavy, fontSize: 13, color: colors.inkSoft },
  textActive: { color: colors.paper },
});
