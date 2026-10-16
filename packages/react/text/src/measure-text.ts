import type { BoardTextDocument } from '@sue/board-common';
import { serializeTextPreview } from './text-preview';

export interface TextMeasurement {
  width: number;
  height: number;
}
let cache = new WeakMap<BoardTextDocument, Map<string, TextMeasurement>>();
let listening = false;
/** Measures the actual schema typography in unscaled CSS pixels. Infinity means natural width. */
export function measureBoardText(
  text: BoardTextDocument,
  width: number,
  fontSize = 16,
  fontFamily?: string,
): TextMeasurement | undefined {
  if (typeof document === 'undefined' || !document.body) return;
  if (!listening && document.fonts) {
    listening = true;
    document.fonts.addEventListener('loadingdone', () => {
      cache = new WeakMap();
      document.dispatchEvent(new Event('board-text-fonts-changed'));
    });
  }
  const family = fontFamily ?? getComputedStyle(document.body).fontFamily;
  const key = `${width}:${fontSize}:${family}`;
  const entries = cache.get(text) ?? new Map<string, TextMeasurement>();
  if (!cache.has(text)) cache.set(text, entries);
  const saved = entries.get(key);
  if (saved) return saved;
  const element = document.createElement('div');
  element.className = 'board-text-content';
  element.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;height:auto;max-height:none;min-height:0;';
  element.style.fontSize = `${fontSize}px`;
  element.style.fontFamily = family;
  element.style.lineHeight = '1.3';
  element.style.width = Number.isFinite(width)
    ? `${Math.max(1, width)}px`
    : 'max-content';
  element.innerHTML = serializeTextPreview(text, true);
  document.body.append(element);
  try {
    const bounds = element.getBoundingClientRect();
    // jsdom and headless engines without layout use the caller's pure fallback.
    if (!bounds.width || !bounds.height) return;
    const result = {
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    };
    entries.set(key, result);
    return result;
  } finally {
    element.remove();
  }
}
