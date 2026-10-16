import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { zhTranslations, enTranslations } from './translations';
import {
  Language,
  Translations,
  I18nContextType,
  I18nProviderProps,
} from './types';

const translations: Record<Language, Translations> = {
  zh: zhTranslations,
  en: enTranslations,
};

let runtimeLanguage: Language = 'zh';
let runtimeMessages: Partial<Record<Language, Partial<Translations>>> = {};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const resolveLanguage = (
  language: Language | undefined,
  defaultLanguage: Language,
  persist: boolean,
): Language => {
  if (language) {
    return language;
  }
  if (persist && typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('language') as Language | null;
    if (stored && stored in translations) {
      return stored;
    }
  }
  return defaultLanguage;
};

const translate = (
  language: Language,
  key: keyof Translations,
  messages?: Partial<Record<Language, Partial<Translations>>>,
) => {
  return (
    messages?.[language]?.[key] ||
    runtimeMessages[language]?.[key] ||
    translations[language][key] ||
    key
  );
};

export const I18nProvider: React.FC<I18nProviderProps> = ({
  children,
  defaultLanguage = 'zh',
  language: controlledLanguage,
  persistLanguage = true,
  messages,
  onLanguageChange,
}) => {
  if (messages) {
    runtimeMessages = messages;
  }

  const [uncontrolledLanguage, setUncontrolledLanguage] = useState<Language>(
    () => resolveLanguage(controlledLanguage, defaultLanguage, persistLanguage),
  );

  const language = controlledLanguage ?? uncontrolledLanguage;
  runtimeLanguage = language;

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.title = translate(language, 'app.name', messages);
  }, [language, messages]);

  const setLanguage = (newLanguage: Language) => {
    runtimeLanguage = newLanguage;
    if (persistLanguage && typeof localStorage !== 'undefined') {
      localStorage.setItem('language', newLanguage);
    }
    if (controlledLanguage === undefined) {
      setUncontrolledLanguage(newLanguage);
    }
    onLanguageChange?.(newLanguage);
  };

  const t = (key: keyof Translations): string => {
    return translate(language, key, messages);
  };

  const value: I18nContextType = useMemo(
    () => ({
      language,
      setLanguage,
      t,
    }),
    [language, messages],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }

  return context;
};

export const i18nInsideBoardHook = () => {
  const i18n = {
    t: (key: keyof Translations): string => {
      return translate(runtimeLanguage, key);
    },
    language: runtimeLanguage,
  };

  return i18n;
};

export type { Language, Translations, I18nContextType };
