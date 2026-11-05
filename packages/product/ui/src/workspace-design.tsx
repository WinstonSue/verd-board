import {
  Button,
  ConfigProvider,
  Input,
  InputNumber,
  theme,
  type ButtonProps,
  type InputProps,
  type InputNumberProps,
} from '@sue/design-web-react';
import enUS from '@sue/design-web-react/locale/en_US';
import zhCN from '@sue/design-web-react/locale/zh_CN';
import {
  forwardRef,
  useMemo,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { useAppearancePreference } from './appearance-preferences';
import { useI18n } from './i18n';

export {
  Alert as WorkspaceAlert,
  Empty as WorkspaceEmptyState,
  Tabs as WorkspaceDialogTabs,
  Checkbox as WorkspaceCheckbox,
  Tag as WorkspaceTag,
} from '@sue/design-web-react';

export function WorkspaceDesignProvider({ children }: { children: ReactNode }) {
  const { appearance } = useAppearancePreference();
  const { language } = useI18n();
  const config = useMemo(
    () => ({
      algorithm:
        appearance === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: appearance === 'dark' ? '#a5b4fc' : '#4f46e5',
        borderRadius: 8,
        controlHeight: 34,
      },
    }),
    [appearance],
  );
  return (
    <ConfigProvider
      locale={language === 'en' ? enUS : zhCN}
      theme={config}
      getPopupContainer={(trigger) =>
        trigger?.closest('dialog') ?? document.body
      }
    >
      {children}
    </ConfigProvider>
  );
}

export function useWorkspaceDesignVariables(): CSSProperties {
  const { token } = theme.useToken();
  return {
    '--workspace-control-radius': `${token.borderRadius}px`,
    '--workspace-control-height': `${token.controlHeight}px`,
    '--workspace-gap': `${token.marginSM}px`,
  } as CSSProperties;
}

type WorkspaceButtonProps = ComponentProps<'button'> & {
  intent?: 'primary' | 'secondary' | 'ghost';
  busy?: boolean;
  danger?: boolean;
  size?: ButtonProps['size'];
  icon?: ReactNode;
  variant?: ButtonProps['variant'];
};

export const WorkspaceButton = forwardRef<
  HTMLButtonElement,
  WorkspaceButtonProps
>(function WorkspaceButton(
  { type = 'button', intent = 'secondary', busy, color: _color, ...props },
  ref,
) {
  return (
    <Button
      {...props}
      ref={ref as Ref<HTMLButtonElement | HTMLAnchorElement>}
      htmlType={type}
      type={
        intent === 'primary'
          ? 'primary'
          : intent === 'ghost'
            ? 'text'
            : 'default'
      }
      loading={busy}
      autoInsertSpace={false}
    />
  );
});

export const WorkspaceInput = forwardRef<HTMLInputElement, InputProps>(
  function WorkspaceInput(props, ref) {
    return (
      <Input
        {...props}
        ref={(instance) => {
          const node = instance?.input ?? null;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
      />
    );
  },
);

export const WorkspaceTextArea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<typeof Input.TextArea>
>(function WorkspaceTextArea(props, ref) {
  return (
    <Input.TextArea
      {...props}
      ref={(instance) => {
        const node = instance?.resizableTextArea?.textArea ?? null;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
    />
  );
});

/** Preserve unfinished/invalid text until the settings host validates the draft. */
export const WorkspaceNumberInput = forwardRef<
  HTMLInputElement,
  Omit<
    InputNumberProps<string | number>,
    'value' | 'onChange' | 'onInput' | 'onStep'
  > & {
    value: string;
    onValueChange(value: string): void;
  }
>(function WorkspaceNumberInput({ value, onValueChange, ...props }, ref) {
  return (
    <InputNumber<string | number>
      {...props}
      ref={(instance) => {
        const node = instance?.nativeElement.querySelector('input') ?? null;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      stringMode
      value={value || null}
      changeOnBlur={false}
      formatter={(_, { userTyping, input }) => (userTyping ? input : value)}
      onInput={onValueChange}
      onStep={(next) => onValueChange(String(next))}
    />
  );
});
