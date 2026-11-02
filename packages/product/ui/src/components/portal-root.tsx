import { createContext, useContext } from 'react';
export const PortalRootContext = createContext<HTMLElement | null | undefined>(
  undefined,
);
export const usePortalRoot = () => useContext(PortalRootContext);
