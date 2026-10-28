import { createContext, useContext, type ReactNode } from 'react';
import type { FrameLanguage } from './frame-plugins';
export interface FrameI18n {
  language: FrameLanguage;
  t(key: string): string;
}
const Context = createContext<FrameI18n>({ language: 'zh', t: (key) => key });
export function FrameI18nProvider({
  language = 'zh',
  messages = {},
  children,
}: {
  language?: FrameLanguage;
  messages?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={{ language, t: (key) => messages[key] ?? key }}>
      {children}
    </Context.Provider>
  );
}
export const useFrameI18n = () => useContext(Context);
