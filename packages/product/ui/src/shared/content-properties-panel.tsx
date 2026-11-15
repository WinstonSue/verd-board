import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/board-react';
import { SettingsDraftInput } from './settings-draft';
interface Values {
  tags: string;
  status: string;
  source: string;
}
interface Controls {
  draft: { label: string; numeric?: boolean; testId?: string };
}
const definition = defineSettings<Values, void, Controls>({
  fields: [
    {
      key: 'tags',
      label: '内容标签',
      editor: 'draft',
      props: { label: '内容标签' },
      commit: 'change',
    },
    {
      key: 'status',
      label: '内容状态',
      editor: 'draft',
      props: { label: '内容状态' },
      commit: 'change',
    },
    {
      key: 'source',
      label: '内容来源',
      editor: 'draft',
      props: { label: '内容来源' },
      commit: 'change',
    },
  ],
});
const components = {
  draft: ({
    value,
    props,
    onCommit,
  }: SettingEditorProps<unknown, Controls['draft']>) => (
    <SettingsDraftInput
      value={String(value ?? '')}
      numeric={props.numeric}
      label={props.label}
      testId={props.testId ?? 'content-property-' + props.label}
      onSave={(value) => onCommit(value)}
    />
  ),
};
export function ContentPropertiesPanel({
  identity,
  value,
  disabled,
  onChange,
  locale = 'zh',
}: {
  locale?: 'zh' | 'en';
  identity: string;
  value: { tags: string[]; status?: string; source?: string };
  disabled?: boolean;
  onChange(value: {
    tags: string[];
    status: string;
    source: string;
  }): Promise<void>;
}) {
  const values: Values = {
    tags: value.tags.join(', '),
    status: value.status ?? '',
    source: value.source ?? '',
  };
  return (
    <fieldset disabled={disabled}>
      <ConfigPanel
        identity={identity}
        definition={
          locale === 'zh'
            ? definition
            : {
                ...definition,
                fields: definition.fields.map((field) => {
                  const label =
                    (
                      {
                        tags: 'Content tags',
                        status: 'Content status',
                        source: 'Content source',
                      } as Record<string, string>
                    )[field.key] ?? String(field.label);
                  return {
                    ...field,
                    label,
                    props: {
                      ...field.props,
                      label,
                      testId:
                        'content-property-' +
                        (field.props as { label: string }).label,
                    },
                  };
                }),
              }
        }
        values={values}
        components={components}
        onCommit={async ({ changes }) => {
          const next = { ...values };
          for (const change of changes)
            next[change.key] =
              change.kind === 'set' ? String(change.value) : '';
          try {
            await onChange({
              tags: [
                ...new Set(
                  next.tags
                    .split(/[,，]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                ),
              ],
              status: next.status.trim(),
              source: next.source.trim(),
            });
            return { status: 'accepted' };
          } catch (cause) {
            return { status: 'rejected', message: String(cause) };
          }
        }}
        renderField={({ label, editor }) => (
          <label>
            {label}
            {editor}
          </label>
        )}
      />
    </fieldset>
  );
}

export function ContentImageProperties({
  identity,
  index,
  width,
  caption,
  disabled,
  onChange,
  locale = 'zh',
}: {
  locale?: 'zh' | 'en';
  identity: string;
  index: number;
  width?: number;
  caption?: string;
  disabled?: boolean;
  onChange(patch: { width?: number | null; caption?: string }): Promise<void>;
}) {
  const definition = defineSettings<
    { width: string; caption: string },
    void,
    Controls
  >({
    fields: [
      {
        key: 'width',
        label: locale === 'zh' ? '宽度' : 'Width',
        editor: 'draft',
        props: {
          label: (locale === 'zh' ? '图片宽度 ' : 'Image width ') + index,
          numeric: true,
          testId: 'content-property-图片宽度 ' + index,
        },
        commit: 'change',
      },
      {
        key: 'caption',
        label: locale === 'zh' ? '说明' : 'Caption',
        editor: 'draft',
        props: {
          label: (locale === 'zh' ? '图片说明 ' : 'Image caption ') + index,
          testId: 'content-property-图片说明 ' + index,
        },
        commit: 'change',
      },
    ],
  });
  return (
    <fieldset disabled={disabled}>
      <ConfigPanel
        identity={identity}
        definition={definition}
        values={{ width: width ? String(width) : '', caption: caption ?? '' }}
        components={components}
        onCommit={async ({ changes }) => {
          const patch: { width?: number | null; caption?: string } = {};
          for (const change of changes) {
            const value = change.kind === 'set' ? String(change.value) : '';
            if (change.key === 'width') {
              const number = Number(value);
              if (
                value &&
                (!Number.isFinite(number) || number < 24 || number > 2000)
              )
                return {
                  status: 'rejected',
                  message:
                    locale === 'zh'
                      ? '图片宽度应在 24 到 2000 之间'
                      : 'Image width must be between 24 and 2000',
                };
              patch.width = value ? number : null;
            } else patch.caption = value;
          }
          try {
            await onChange(patch);
            return { status: 'accepted' };
          } catch (cause) {
            return { status: 'rejected', message: String(cause) };
          }
        }}
        renderField={({ label, editor }) => (
          <label>
            {label}
            {editor}
          </label>
        )}
      />
    </fieldset>
  );
}
