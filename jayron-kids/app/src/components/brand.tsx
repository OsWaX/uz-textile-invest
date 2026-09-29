/** Элементы фирменного стиля: надпись JAYRON KIDS, значки ценностей бренда, пустые состояния. */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import { colors, fonts, space } from '@/theme';
import { Button, T } from './ui';

// Цвета букв логотипа: J — бирюзовый, A — коралловый, Y — жёлтый, R — голубой, O — коралловый, N — зелёный
const LETTERS: [string, string][] = [
  ['J', colors.teal], ['A', colors.coral], ['Y', colors.sunny], ['R', colors.sky], ['O', colors.coral], ['N', colors.leaf],
];

export function Wordmark({ size = 30, showKids = true }: { size?: number; showKids?: boolean }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Jayron Kids" style={styles.wordmark}>
      <View style={styles.letters}>
        {LETTERS.map(([letter, color], index) => (
          <Text
            key={letter + index}
            style={[styles.letter, { fontSize: size, lineHeight: size * 1.1, color }]}
          >
            {letter}
          </Text>
        ))}
      </View>
      {showKids ? (
        <View style={styles.kidsRow}>
          <View style={[styles.kidsLine, { width: size * 0.5 }]} />
          <Text style={[styles.kids, { fontSize: size * 0.36, letterSpacing: size * 0.18 }]}>KIDS</Text>
          <View style={[styles.kidsLine, { width: size * 0.5 }]} />
        </View>
      ) : null}
    </View>
  );
}

export function Emblem({ size = 44 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/emblem.png')}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

// ------------------------------------------------------------------ значки ценностей
export function SunIcon({ size = 36 }: { size?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {rays.map((a) => (
        <Line key={a} x1={20 + Math.cos(a) * 13} y1={20 + Math.sin(a) * 13} x2={20 + Math.cos(a) * 18} y2={20 + Math.sin(a) * 18}
          stroke={colors.sunny} strokeWidth={3} strokeLinecap="round" />
      ))}
      <Circle cx={20} cy={20} r={9} fill={colors.sunny} />
    </Svg>
  );
}

export function HeartIcon({ size = 36, color = colors.coral }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M20 34 C8 25 4 18 7 11 C10 5 17 5 20 11 C23 5 30 5 33 11 C36 18 32 25 20 34 Z" fill={color} />
    </Svg>
  );
}

export function SproutIcon({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M20 36 L20 18" stroke={colors.leafInk} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M20 22 C10 22 6 14 7 6 C15 6 21 12 20 22 Z" fill={colors.leaf} />
      <Path d="M20 26 C27 26 33 20 33 12 C25 12 20 18 20 26 Z" fill={colors.teal} />
    </Svg>
  );
}

export function RainbowIcon({ size = 36 }: { size?: number }) {
  const arcs: [number, string][] = [[16, colors.coral], [12.5, colors.sunny], [9, colors.leaf], [5.5, colors.sky]];
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <G>
        {arcs.map(([r, color]) => (
          <Path key={r} d={`M${20 - r} 30 A${r} ${r} 0 0 1 ${20 + r} 30`} stroke={color} strokeWidth={3.4} fill="none" />
        ))}
      </G>
    </Svg>
  );
}

// ------------------------------------------------------------------ пустые состояния
export function EmptyState({
  title, hint, action, onAction, icon,
}: { title: string; hint?: string; action?: string; onAction?: () => void; icon?: ReactNode }) {
  return (
    <View style={styles.empty}>
      {icon ?? <Emblem size={96} />}
      <T variant="h2" center>{title}</T>
      {hint ? <T variant="body" color={colors.inkSoft} center>{hint}</T> : null}
      {action && onAction ? <Button title={action} onPress={onAction} style={{ alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { alignItems: 'center' },
  letters: { flexDirection: 'row' },
  letter: { fontFamily: fonts.black, includeFontPadding: false },
  kidsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  kidsLine: { height: 2, borderRadius: 1, backgroundColor: '#6B3A1D' },
  kids: { fontFamily: fonts.black, color: '#6B3A1D', includeFontPadding: false },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl, paddingTop: 48 },
});
