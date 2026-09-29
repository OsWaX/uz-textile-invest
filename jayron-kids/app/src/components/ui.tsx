/** Базовые элементы интерфейса в стиле бренда: текст, кнопки, чипы, поля, заголовки секций. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';

import { useStore } from '@/lib/store';
import { colors, fonts, headingFont, radius, space } from '@/theme';

// ------------------------------------------------------------------ текст
const TEXT_VARIANTS = StyleSheet.create({
  display: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 34, color: colors.ink },
  h1: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 30, color: colors.ink },
  h2: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26, color: colors.ink },
  h3: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  bodyBold: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 22, color: colors.ink },
  small: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  price: { fontFamily: fonts.heavy, fontSize: 17, lineHeight: 22, color: colors.ink },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
});

type TProps = TextProps & { variant?: keyof typeof TEXT_VARIANTS; color?: string; center?: boolean };

const HEADINGS = new Set(['display', 'h1', 'h2', 'h3']);

export function T({ variant = 'body', color, center, style, ...rest }: TProps) {
  const { lang } = useStore();
  const heading = HEADINGS.has(variant) && lang === 'ru' ? { fontFamily: headingFont(lang) } : null;
  return (
    <Text
      {...rest}
      style={[TEXT_VARIANTS[variant], heading, color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
    />
  );
}

// ------------------------------------------------------------------ кнопки
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'sunny';

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.tealInk, fg: colors.paper },
  secondary: { bg: colors.tealSoft, fg: colors.tealInk },
  ghost: { bg: 'transparent', fg: colors.ink, border: colors.line },
  danger: { bg: colors.coralSoft, fg: colors.coralInk },
  sunny: { bg: colors.sunny, fg: colors.ink },
};

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, small, style, accessibilityHint }: ButtonProps) {
  const palette = BUTTON_COLORS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: palette.bg, borderColor: palette.border ?? palette.bg },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        inactive && { opacity: 0.55 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 20} color={palette.fg} /> : null}
          <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: palette.fg }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon, onPress, label, color = colors.ink, background = colors.paper, size = 22, badge,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label: string;
  color?: string;
  background?: string;
  size?: number;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: background }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={size} color={color} />
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
    </Pressable>
  );
}

// ------------------------------------------------------------------ чипы
export function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: color ?? colors.ink, borderColor: color ?? colors.ink },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.chipText, active && { color: color ? colors.ink : colors.paper }]}>{label}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ поля ввода
type FieldProps = TextInputProps & { label: string; error?: string | null; prefix?: string; containerStyle?: StyleProp<ViewStyle> };

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, prefix, containerStyle, style, ...rest },
  ref,
) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error ? { borderColor: colors.coralInk } : null]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor="#A8917D"
          accessibilityLabel={label}
          style={[styles.input, style as StyleProp<TextStyle>]}
          {...rest}
        />
      </View>
      {error ? <Text style={styles.fieldError} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
});

// ------------------------------------------------------------------ разное
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <T variant="h2" accessibilityRole="header">{title}</T>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="link" style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.tealInk} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Row({ label, value, bold, valueColor }: { label: string; value: string; bold?: boolean; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <T variant={bold ? 'bodyBold' : 'body'} style={bold ? { fontSize: 17 } : null}>{label}</T>
      <T variant={bold ? 'price' : 'bodyBold'} color={valueColor}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.sm + 2 },
  buttonText: { fontFamily: fonts.heavy, fontSize: 16 },
  buttonTextSmall: { fontSize: 14 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.coralInk,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.paper, fontFamily: fonts.heavy, fontSize: 11 },
  chip: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    justifyContent: 'center',
  },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  field: { gap: 6 },
  fieldLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderRadius: radius.md - 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
  },
  prefix: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink, marginRight: 6 },
  input: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  fieldError: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.coralInk },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  sectionActionText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.tealInk },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  divider: { height: 1, backgroundColor: colors.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
});
