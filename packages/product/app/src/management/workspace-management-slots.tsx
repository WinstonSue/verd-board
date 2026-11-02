import { WorkspaceMenu, type WorkspaceMenuProps } from '@sue/verd-board-ui';
import { createContext, useContext, type ReactNode } from 'react';
export const ManagementContext = createContext<{
  sidebar: ReactNode;
  main: ReactNode;
  toggle: ReactNode;
  resize: ReactNode;
  switcherOpen: boolean;
}>({
  sidebar: null,
  main: null,
  toggle: null,
  resize: null,
  switcherOpen: false,
});
export const WorkspaceManagementSidebar = () =>
  useContext(ManagementContext).sidebar;
export const WorkspaceManagementMain = () => useContext(ManagementContext).main;

export const WorkspaceManagementResize = () =>
  useContext(ManagementContext).resize;

export function WorkspaceManagementMenu(props: WorkspaceMenuProps) {
  const context = useContext(ManagementContext);
  return (
    <WorkspaceMenu
      {...props}
      trailing={context.toggle}
      switcherOpen={context.switcherOpen}
    />
  );
}
