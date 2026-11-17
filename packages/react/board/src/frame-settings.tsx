import {
  ConfigPanel as SchemaConfigPanel,
  defineSettings,
  type CommitMode,
  type SettingEditorProps,
  type CommitResult,
  type ControlProps,
  type ConfigPanelProps,
  type SettingsDefinition,
  type SettingsComponents,
} from '@sue/schema-settings-react';
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import { NumberEditor, type NumberProps } from './frame-property-number';
import { useFrameI18n } from './frame-i18n';
import { FramePropertyContext } from './frame-property-panel';

export { defineSettings } from '@sue/schema-settings-react';
export type {
  ConfigPanelProps,
  SettingsDefinition,
  SettingsChange,
  FieldState,
  SettingEditorProps,
  SettingsRequest,
} from '@sue/schema-settings-react';

type FrameSettingsComponents = Pick<SettingsComponents<ControlProps>, 'select'>;
const SettingsComponentsContext = createContext<FrameSettingsComponents>({});

/** Hosts can supply window-local controls without adding a design-library dependency to the SDK. */
export function FrameSettingsComponentsProvider({
  components,
  children,
}: {
  components: FrameSettingsComponents;
  children: ReactNode;
}) {
  const inherited = useContext(SettingsComponentsContext);
  return (
    <SettingsComponentsContext.Provider value={{ ...inherited, ...components }}>
      {children}
    </SettingsComponentsContext.Provider>
  );
}

export function ConfigPanel<T extends object, C = void, R = ControlProps>(
  props: ConfigPanelProps<T, C, R>,
) {
  const inherited = useContext(SettingsComponentsContext);
  return (
    <SchemaConfigPanel
      {...props}
      components={
        { ...inherited, ...props.components } as SettingsComponents<R>
      }
    />
  );
}

function optionText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join('');
}

/** Preserve native option values, including implicit text values and disabled groups. */
function selectOptions(
  children: ReactNode,
  disabled = false,
): {
  value: string;
  label: string;
  disabled: boolean;
}[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
      }>(child)
    )
      return [];
    const text = optionText(child.props.children);
    const blocked = disabled || !!child.props.disabled;
    return child.type === 'option'
      ? [
          {
            value: String(child.props.value ?? text),
            label: child.props.label ?? text,
            disabled: blocked,
          },
        ]
      : selectOptions(child.props.children, blocked);
  });
}

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange'
> & {
  children?: ReactNode;
  [attribute: `data-${string}`]: unknown;
};
interface NativeControls {
  native: NativeProps & { kind: 'input' | 'select' };
}
function NativeEditor({
  value,
  props,
  disabled,
  onCommit,
  ...editor
}: SettingEditorProps<unknown, NativeControls['native']>) {
  const SelectEditor = useContext(SettingsComponentsContext).select;
  const { kind, children, ...attributes } = props;
  if (kind === 'select' && SelectEditor)
    return (
      <SelectEditor
        {...editor}
        value={value === undefined ? undefined : String(value)}
        props={{
          // Schema editors accept scalar DOM attributes rather than native event handlers.
          attributes: Object.fromEntries(
            Object.entries(attributes).filter(
              ([, attribute]) =>
                attribute === undefined ||
                ['string', 'number', 'boolean'].includes(typeof attribute),
            ),
          ),
        }}
        options={selectOptions(children)}
        disabled={disabled}
        onCommit={onCommit}
      />
    );
  return kind === 'select' ? (
    <select
      {...(attributes as SelectHTMLAttributes<HTMLSelectElement>)}
      disabled={disabled}
      value={value as string | number | undefined}
      onChange={(event) => onCommit(event.target.value)}
    >
      {children}
    </select>
  ) : (
    <input
      {...attributes}
      disabled={disabled}
      value={
        props.type === 'checkbox'
          ? undefined
          : (value as string | number | undefined)
      }
      checked={props.type === 'checkbox' ? !!value : undefined}
      onChange={(event) =>
        onCommit(
          props.type === 'checkbox' ? event.target.checked : event.target.value,
        )
      }
    />
  );
}
const nativeComponents = { native: NativeEditor };

/** Incremental field declarations share the same SDK as complete panels; no DOM wrapper is introduced. */
export function FrameSettingsControl<
  V extends string | number | boolean | undefined,
>({
  field,
  value,
  onCommit,
  identity,
}: {
  field: {
    key: string;
    editor: 'input' | 'select';
    props: NativeProps;
    commit?: 'change';
  };
  value: V;
  onCommit(value: V): unknown;
  identity?: string;
}) {
  const context = useContext(FramePropertyContext);
  const definition = defineSettings<{ value: V }, void, NativeControls>({
    fields: [
      {
        key: 'value',
        editor: 'native',
        props: { ...field.props, kind: field.editor },
        commit: field.commit ?? 'change',
      },
    ],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={{ value }}
      identity={`${context.identity}:${identity ?? field.key}`}
      disabled={context.disabled || !!field.props.disabled}
      fieldStates={{
        value: {
          mixed: !!field.props['data-mixed'],
          readonly: !!field.props.readOnly,
        },
      }}
      components={nativeComponents}
      renderField={({ editor }) => editor}
      onCommit={async (request) => {
        for (const change of request.changes) {
          if (change.kind === 'set') {
            const result = await settingsCommitResult(onCommit(change.value));
            if (result?.status === 'rejected') return result;
          }
        }
        return { status: 'accepted' };
      }}
    />
  );
}

export function FrameSettingsText({
  field,
  value,
  onCommit,
  identity,
  disabled,
}: {
  field: {
    key: string;
    label?: string;
    props?: ControlProps['text'];
    commit?: CommitMode;
  };
  value: string;
  onCommit(value: string): unknown;
  identity?: string;
  disabled?: boolean;
}) {
  const context = useContext(FramePropertyContext);
  const definition = defineSettings<{ text: string }>({
    fields: [
      {
        key: 'text',
        editor: 'text',
        label: field.label,
        props: field.props,
        commit: field.commit ?? 'blur',
      },
    ],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={{ text: value }}
      identity={`${context.identity}:${identity ?? field.key}`}
      disabled={context.disabled || disabled}
      renderField={({ editor }) => editor}
      onCommit={async ({ changes }) => {
        for (const change of changes)
          if (change.kind === 'set') {
            const result = await settingsCommitResult(onCommit(change.value));
            if (result?.status === 'rejected') return result;
          }
        return { status: 'accepted' };
      }}
    />
  );
}

export interface FrameSettingsContribution {
  id: string;
  render(context: import('./frame-plugins').FramePluginContext): ReactNode;
}

export function createFrameSettingsContribution<
  T extends object,
  C = void,
  R = ControlProps,
>({
  id,
  definition,
  bind,
}: {
  id: string;
  definition: SettingsDefinition<T, C, R>;
  bind(
    context: import('./frame-plugins').FramePluginContext,
  ): Omit<ConfigPanelProps<T, C, R>, 'definition'> | null;
}): FrameSettingsContribution {
  return {
    id,
    render(context) {
      const binding = bind(context);
      return binding && <ConfigPanel {...binding} definition={definition} />;
    },
  };
}

/** Normalize the existing transaction result without adding a second transaction protocol. */
export async function settingsCommitResult(
  result: unknown,
): Promise<CommitResult> {
  const resolved = await result;
  return resolved &&
    typeof resolved === 'object' &&
    'status' in resolved &&
    resolved.status === 'rejected'
    ? {
        status: 'rejected',
        message:
          'message' in resolved ? String(resolved.message) : 'Edit rejected',
      }
    : { status: 'accepted' };
}

export type GeometrySettingKey = 'x' | 'y' | 'width' | 'height';
export function FrameGeometryControls({
  values,
  identity,
  disabled,
  onCommit,
  minDimension = 1,
  precision,
  shortLabels = false,
}: {
  values: Record<GeometrySettingKey, number>;
  identity: string;
  disabled(key: GeometrySettingKey): boolean;
  onCommit(key: GeometrySettingKey, value: number): void;
  minDimension?: number;
  precision?: number;
  shortLabels?: boolean;
}) {
  const context = useContext(FramePropertyContext);
  const { language } = useFrameI18n();
  type GeometryControls = {
    geometryNumber: Omit<NumberProps, 'value' | 'onCommit'>;
  };
  const definition = defineSettings<
    Record<GeometrySettingKey, number>,
    void,
    GeometryControls
  >({
    fields: (['x', 'y', 'width', 'height'] as const).map((key) => ({
      key,
      editor: 'geometryNumber',
      disabled: disabled(key),
      label: shortLabels
        ? key
        : key === 'width'
          ? language === 'zh'
            ? '宽度'
            : 'Width'
          : key === 'height'
            ? language === 'zh'
              ? '高度'
              : 'Height'
            : key.toUpperCase(),
      props: {
        'aria-label': key,
        min: key === 'width' || key === 'height' ? minDimension : undefined,
        precision,
        step: 1,
      },
    })),
  });
  return (
    <ConfigPanel
      definition={definition}
      values={values}
      identity={`${context.identity}:${identity}`}
      disabled={context.disabled}
      components={{ geometryNumber: NumberEditor }}
      renderField={({ label, editor }) => (
        <label>
          {shortLabels ? label : <span>{label}</span>}
          {editor}
        </label>
      )}
      onCommit={({ changes }) => {
        for (const change of changes)
          if (change.kind === 'set') onCommit(change.key, change.value);
      }}
    />
  );
}
