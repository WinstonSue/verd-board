import { DEFAULT_MIND_MAX_WIDTH } from '@sue/board-mind';
import { createContext, useContext } from 'react';
/** A provider belongs to one editor; embedded editors never share mutable preferences. */
export const MindUISettings = createContext({
  maxNodeWidth: DEFAULT_MIND_MAX_WIDTH,
});
export const useMindMaxWidth = () => useContext(MindUISettings).maxNodeWidth;
