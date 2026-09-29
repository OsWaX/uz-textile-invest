import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, T } from '@/components/ui';
import { CAP_TABLE, SIZE_TABLE } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { colors, fonts, radius, space } from '@/theme';

export default function SizeGuideScreen() {
  const { t, pick } = useStore();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <T variant="h2">{t('sizeGuideTitle')}</T>
      <T variant="body">{t('sizeGuideIntro')}</T>
      <View style={styles.tip}><T variant="bodyBold">💡 {t('sizeGuideTip')}</T></View>

      <Card style={styles.table}>
        <View style={[styles.tr, styles.th]}>
          <Text style={[styles.cell, styles.head]}>{t('sizeColumn')}</Text>
          <Text style={[styles.cell, styles.head]}>{t('heightColumn')}</Text>
          <Text style={[styles.cell, styles.head, styles.wide]}>{t('ageColumn')}</Text>
        </View>
        {/* Размер N подходит на рост от N−3 до N+2 см (шаг размерной сетки — 6 см) */}
        {SIZE_TABLE.map((row, index) => (
          <View key={row.size} style={[styles.tr, index % 2 === 1 && styles.striped]}>
            <Text style={[styles.cell, styles.bold]}>{row.size}</Text>
            <Text style={styles.cell}>{`${Number(row.size) - 3}–${Number(row.size) + 2}`}</Text>
            <Text style={[styles.cell, styles.wide]}>{pick(row.age)}</Text>
          </View>
        ))}
      </Card>

      <T variant="h3">{t('capSizes')}</T>
      <Card style={styles.table}>
        {CAP_TABLE.map((row, index) => (
          <View key={row.size} style={[styles.tr, index % 2 === 1 && styles.striped]}>
            <Text style={[styles.cell, styles.bold]}>{row.size}</Text>
            <Text style={[styles.cell, styles.wide]}>{pick(row.age)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' },
  tip: { backgroundColor: colors.sunnySoft, borderRadius: radius.md, padding: space.md },
  table: { padding: 0, gap: 0, overflow: 'hidden' },
  tr: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: 10 },
  th: { backgroundColor: colors.tealSoft },
  striped: { backgroundColor: '#FFFBF2' },
  cell: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  wide: { flex: 1.4 },
  head: { fontFamily: fonts.heavy, fontSize: 13, color: colors.tealInk },
  bold: { fontFamily: fonts.heavy },
});
