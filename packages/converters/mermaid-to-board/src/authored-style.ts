import { createInlineText, formatBoardText } from '@sue/board-common';
import type { NodeAppearance, EdgeAppearance } from '@sue/board-core';
import type { AuthoredStyle } from './interfaces';

export const parseAuthoredStyle = (
  declarations: readonly string[],
): AuthoredStyle => {
  const result: AuthoredStyle = {};
  for (const declaration of declarations) {
    const at = declaration.indexOf(':');
    if (at < 0) continue;
    const key = declaration.slice(0, at).trim();
    if (
      ['fill', 'stroke', 'color', 'stroke-width', 'stroke-dasharray'].includes(
        key,
      )
    )
      result[key as keyof AuthoredStyle] = declaration
        .slice(at + 1)
        .trim()
        .replace(/\s*!important\s*$/, '');
  }
  return result;
};

export const authoredAppearance = (style?: AuthoredStyle): NodeAppearance => ({
  colorSources: {
    fill: style?.fill === undefined ? 'theme' : 'custom',
    strokeColor: style?.stroke === undefined ? 'theme' : 'custom',
  },
  ...(style?.fill !== undefined ? { fill: style.fill } : {}),
  ...(style?.stroke !== undefined ? { strokeColor: style.stroke } : {}),
  ...(style?.['stroke-width']
    ? { strokeWidth: parseFloat(style['stroke-width']) }
    : {}),
  ...(style?.['stroke-dasharray'] ? { strokeStyle: 'dashed' as const } : {}),
});

export const authoredText = (text: string, style?: AuthoredStyle) => {
  const document = createInlineText(text);
  return style?.color
    ? formatBoardText(document, { color: style.color })
    : document;
};

export const authoredEdgeAppearance = (
  style?: AuthoredStyle,
): EdgeAppearance => {
  const {
    fill: _fill,
    colorSources,
    ...appearance
  } = authoredAppearance(style);
  return {
    ...appearance,
    colorSources: { strokeColor: colorSources?.strokeColor },
  };
};
