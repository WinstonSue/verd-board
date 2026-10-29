import { Color } from '@tiptap/extension-color';
import { getStyleProperty } from '@tiptap/react';

/** One schema renders both literal third-party text and adaptive product text. */
export const ThemeColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-board-original-color') ??
              (
                getStyleProperty(element, 'color') ?? element.style.color
              )?.replace(/['"]+/g, ''),
            renderHTML: (attrs: Record<string, unknown>) => {
              if (!attrs['color']) return {};
              const color = String(attrs['color']);
              return {
                'data-board-original-color': color,
                ...(attrs['colorSource'] === 'custom' ||
                attrs['colorSource'] === 'theme'
                  ? { 'data-board-color-source': attrs['colorSource'] }
                  : {}),
                style: `color: ${attrs['colorSource'] === 'custom' ? color : `var(--board-unmarked-text-color, ${color})`}`,
              };
            },
          },
          colorSource: {
            default: undefined,
            isRequired: false,
            parseHTML: (element: HTMLElement) => {
              const source = element.getAttribute('data-board-color-source');
              return source === 'theme' || source === 'custom'
                ? source
                : element.hasAttribute('data-board-original-color')
                  ? undefined
                  : element.style.color
                    ? 'custom'
                    : undefined;
            },
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setColor:
        (color: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { color, colorSource: 'custom' }).run(),
      unsetColor:
        () =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { color: null, colorSource: undefined })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
