import { createContext, useContext, type ReactNode } from 'react';
export const ManagementContext = createContext<{
  sidebar: ReactNode;
  main: ReactNode;
  toggle: ReactNode;
  resize: ReactNode;
}>({
  sidebar: null,
  main: null,
  toggle: null,
  resize: null,
});
export const WorkspaceManagementSidebar = () =>
  useContext(ManagementContext).sidebar;
export const WorkspaceManagementMain = () => useContext(ManagementContext).main;

export const WorkspaceManagementToggle = () =>
  useContext(ManagementContext).toggle;

export const WorkspaceManagementResize = () =>
  useContext(ManagementContext).resize;
