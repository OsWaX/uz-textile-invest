/**
 * Рисунки изделий в цвете варианта. Показываются, пока у товара нет фотографий,
 * и в категориях каталога. Все рисунки — в поле 100×100.
 */
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import type { GarmentKind } from '@/lib/types';
import { colors, isLight, shade } from '@/theme';

type Props = { kind: GarmentKind; color: string; size?: number; heart?: boolean };

const HEART = 'M5 9 C1 6 0 4 1.5 2.3 C2.8 0.9 4.5 1.3 5 2.8 C5.5 1.3 7.2 0.9 8.5 2.3 C10 4 9 6 5 9 Z';

const SHAPES = {
  tshirt: 'M31 20 L42 15 Q50 22 58 15 L69 20 L86 33 L78 44 L70 39 L70 86 Q50 89 30 86 L30 39 L22 44 L14 33 Z',
  sweatshirt: 'M32 17 L42 14 Q50 20 58 14 L68 17 Q80 22 84 38 L91 72 L80 76 L72 46 L72 82 L28 82 L28 46 L20 76 L9 72 L16 38 Q20 22 32 17 Z',
  pants: 'M30 12 L70 12 L75 88 L55 88 L50 42 L45 88 L25 88 Z',
  shorts: 'M26 28 L74 28 L80 68 L55 71 L50 50 L45 71 L20 68 Z',
  dress: 'M40 12 Q50 20 60 12 L66 15 L73 26 L65 31 L62 28 L61 40 Q82 70 86 86 Q50 94 14 86 Q18 70 39 40 L38 28 L35 31 L27 26 L34 15 Z',
  bodysuit: 'M35 14 L44 12 Q50 18 56 12 L65 14 L79 25 L72 33 L66 29 L66 60 Q66 74 58 80 L55 88 L45 88 L42 80 Q34 74 34 60 L34 29 L28 33 L21 25 Z',
  romper: 'M35 10 L44 8 Q50 14 56 8 L65 10 L79 21 L72 29 L67 25 L67 56 L70 86 Q64 92 55 89 L52 60 L48 60 L45 89 Q36 92 30 86 L33 56 L33 25 L28 29 L21 21 Z',
};

export function GarmentArt({ kind, color, size = 120, heart = true }: Props) {
  const light = isLight(color);
  const detail = shade(color, light ? -0.16 : -0.22);
  const outline = light ? { stroke: shade(color, -0.38), strokeWidth: 1.4, strokeLinejoin: 'round' as const } : {};
  const accent = color.toUpperCase() === colors.coral ? colors.paper : colors.coral;
  const dots = shade(color, 0.45);

  // Детали рисунка — функции, а не компоненты: не пересоздаются между отрисовками
  const drawHeart = (x: number, y: number, s = 1) =>
    heart ? <Path d={HEART} fill={accent} transform={`translate(${x} ${y}) scale(${s})`} /> : null;

  const drawSweatshirt = () => (
    <G>
      <Path d={SHAPES.sweatshirt} fill={color} {...outline} />
      <Rect x={28} y={79} width={44} height={7} rx={2} fill={detail} />
      <Path d="M9 72 L20 76 L18.8 81 L8 77 Z M91 72 L80 76 L81.2 81 L92 77 Z" fill={detail} />
      <Path d="M42 14 Q50 22 58 14" stroke={detail} strokeWidth={3} fill="none" />
    </G>
  );

  const drawPants = () => (
    <G>
      <Path d={SHAPES.pants} fill={color} {...outline} />
      <Rect x={30} y={12} width={40} height={8} rx={1.5} fill={detail} />
      <Path d="M25.3 82 L45.5 82 L45 88 L25 88 Z M54.5 82 L74.7 82 L75 88 L55 88 Z" fill={detail} />
      <Path d="M50 20 L50 40" stroke={detail} strokeWidth={1.5} />
    </G>
  );

  let body: React.ReactNode;
  switch (kind) {
    case 'tshirt':
      body = (
        <G>
          <Path d={SHAPES.tshirt} fill={color} {...outline} />
          <Path d="M42 15 Q50 25 58 15" stroke={detail} strokeWidth={3} fill="none" />
          {drawHeart(44, 42, 1.2)}
        </G>
      );
      break;
    case 'sweatshirt':
      body = <G>{drawSweatshirt()}{drawHeart(44, 38, 1.2)}</G>;
      break;
    case 'hoodie':
      body = (
        <G>
          <Path d="M35 22 Q32 4 50 4 Q68 4 65 22 Z" fill={color} {...outline} />
          {drawSweatshirt()}
          <Path d="M41 19 Q41 10 50 10 Q59 10 59 19 Q55 24 50 24 Q45 24 41 19 Z" fill={detail} />
          <Path d="M35 58 L65 58 L69 74 L31 74 Z" fill={detail} />
        </G>
      );
      break;
    case 'jacket':
      body = (
        <G>
          <Path d="M36 22 Q33 6 50 6 Q67 6 64 22 Z" fill={detail} {...outline} />
          {drawSweatshirt()}
          <Path d="M50 17 L50 86" stroke={shade(color, -0.35)} strokeWidth={2} />
          <Path d="M33 58 L40 66 M67 58 L60 66" stroke={detail} strokeWidth={2.5} strokeLinecap="round" />
          <Path d="M13 55 L23 58 M87 55 L77 58" stroke={colors.paper} strokeWidth={2.5} strokeLinecap="round" opacity={0.8} />
        </G>
      );
      break;
    case 'pants':
      body = drawPants();
      break;
    case 'shorts':
      body = (
        <G>
          <Path d={SHAPES.shorts} fill={color} {...outline} />
          <Rect x={26} y={28} width={48} height={8} rx={1.5} fill={detail} />
          <Path d="M33 38 Q36 46 30 50 M67 38 Q64 46 70 50" stroke={detail} strokeWidth={1.8} fill="none" />
        </G>
      );
      break;
    case 'dress':
      body = (
        <G>
          <Path d={SHAPES.dress} fill={color} {...outline} />
          <Path d="M39 40 Q50 44 61 40 L61.8 45.5 Q50 49.5 38.2 45.5 Z" fill={detail} />
          <Path d="M40 12 Q50 20 60 12" stroke={detail} strokeWidth={2.5} fill="none" />
          {[[34, 70], [50, 62], [66, 70], [42, 80], [58, 80], [26, 82], [74, 82]].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2} fill={dots} />
          ))}
        </G>
      );
      break;
    case 'bodysuit':
      body = (
        <G>
          <Path d={SHAPES.bodysuit} fill={color} {...outline} />
          <Path d="M44 12 Q50 20 56 12" stroke={detail} strokeWidth={2.5} fill="none" />
          {[45.5, 50, 54.5].map((cx) => <Circle key={cx} cx={cx} cy={84.5} r={1.4} fill={detail} />)}
          {drawHeart(45, 38, 1)}
        </G>
      );
      break;
    case 'romper':
      body = (
        <G>
          <Path d={SHAPES.romper} fill={color} {...outline} />
          <Path d="M44 8 Q50 16 56 8" stroke={detail} strokeWidth={2.5} fill="none" />
          {[20, 30, 40, 50].map((cy) => <Circle key={cy} cx={50} cy={cy} r={1.5} fill={detail} />)}
          <Path d="M30 86 Q36 92 45 89 M55 89 Q64 92 70 86" stroke={detail} strokeWidth={3} fill="none" />
        </G>
      );
      break;
    case 'set':
    case 'pajama': {
      const pattern = kind === 'pajama';
      body = (
        <G>
          <G transform="translate(40 34) scale(0.62)">
            {drawPants()}
            {pattern && [[38, 32], [60, 50], [34, 62], [64, 76]].map(([cx, cy]) => (
              <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={dots} />
            ))}
          </G>
          <G transform="translate(0 2) scale(0.66)">
            {drawSweatshirt()}
            {pattern
              ? [[40, 35], [60, 45], [45, 60], [62, 68], [30, 55]].map(([cx, cy]) => (
                <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={dots} />
              ))
              : drawHeart(44, 38, 1.4)}
          </G>
        </G>
      );
      break;
    }
    case 'cap':
      body = (
        <G>
          <Path d="M20 64 Q20 26 52 24 Q82 26 82 64 Z" fill={color} {...outline} />
          <Path d="M52 24 Q43 40 41 64 M52 24 Q61 40 63 64" stroke={detail} strokeWidth={1.6} fill="none" />
          <Path d="M62 60 Q90 55 97 66 Q86 73 60 68 Z" fill={detail} {...outline} />
          <Rect x={20} y={61} width={62} height={5} rx={2} fill={detail} />
          <Circle cx={52} cy={24} r={3.2} fill={detail} />
          {drawHeart(30, 42, 1.1)}
        </G>
      );
      break;
    default:
      body = <Path d={SHAPES.tshirt} fill={color} {...outline} />;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {body}
    </Svg>
  );
}

/** Фон под рисунком: светлый оттенок цвета изделия. */
export function artBackground(hex: string): string {
  return isLight(hex) ? colors.sand : shade(hex, 0.8);
}
