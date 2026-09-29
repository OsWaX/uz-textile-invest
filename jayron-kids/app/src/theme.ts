/**
 * Цвета, шрифты и размеры из брендбука Jayron Kids.
 * Яркие цвета бренда используются для фона и акцентов, а для текста
 * на белом — их тёмные варианты (*Ink) с контрастом не ниже 4.5:1.
 */
export const colors = {
  teal: '#00B3A4',
  tealInk: '#00857A',
  tealSoft: '#E0F6F4',
  sky: '#4FB6F2',
  skySoft: '#E3F3FD',
  sunny: '#FFC629',
  sunnySoft: '#FFF3CF',
  coral: '#FF6F61',
  coralInk: '#C2412F',
  coralSoft: '#FFE3DF',
  leaf: '#8BC34A',
  leafInk: '#4E7A1E',
  leafSoft: '#EAF5DC',
  cream: '#FFF7E6',
  logoBg: '#FCF7EE',
  paper: '#FFFFFF',
  ink: '#4A2A14',
  inkSoft: '#7A5A44',
  line: '#EEDFC6',
  sand: '#F6EBD6',
  overlay: 'rgba(74, 42, 20, 0.35)',
} as const;

export const fonts = {
  // Nunito — основной текст: дружелюбный и хорошо читаемый
  body: 'Nunito_400Regular',
  bodySemi: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
  heavy: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
  // Quicksand — заголовки и детали. В Quicksand нет кириллицы,
  // поэтому для русского языка заголовки набираются Nunito (см. headingFont)
  heading: 'Quicksand_700Bold',
  headingSemi: 'Quicksand_600SemiBold',
} as const;

export const headingFont = (lang: 'uz' | 'ru') => (lang === 'ru' ? fonts.heavy : fonts.heading);

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const shadow = {
  shadowColor: '#4A2A14',
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** Осветляет (amount > 0) или затемняет (amount < 0) цвет #RRGGBB. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)),
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Светлый ли цвет — чтобы подобрать обводку и цвет деталей рисунка. */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 200;
}
