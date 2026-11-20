// @vitest-environment jsdom
import { act, useContext, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LinkEditorHost, type LinkEditRequest } from '@sue/board-react-text';
import {
  WorkspaceLinkEditor,
  type WorkspaceLinkChoice,
} from './workspace-link-editor';

vi.mock('./workspace-design', () => ({
  useWorkspaceDesignVariables: () => ({}),
  WorkspaceInput: (props: ComponentProps<'input'>) => <input {...props} />,
  WorkspaceButton: ({
    busy: _busy,
    intent: _intent,
    ...props
  }: ComponentProps<'button'> & { busy?: boolean; intent?: string }) => (
    <button type="button" {...props} />
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};

function Trigger({ request }: { request: LinkEditRequest }) {
  const open = useContext(LinkEditorHost)!;
  return <button onClick={() => open(request)}>Edit selection</button>;
}

async function mount(
  request: LinkEditRequest,
  createFolderLink: (path: string) => Promise<string>,
  choices: WorkspaceLinkChoice[] = [
    { folderPath: 'Plans', title: 'Plans', detail: 'Plans' },
  ],
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (scope: string) =>
    act(async () =>
      root.render(
        <WorkspaceLinkEditor
          scope={scope}
          locale="en"
          choices={choices}
          createFolderLink={createFolderLink}
        >
          <Trigger request={request} />
        </WorkspaceLinkEditor>,
      ),
    );
  await render('first');
  const click = async (title: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === title,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  const dispose = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  const input = () =>
    container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const fill = (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const choose = async (query: string, path: string) => {
    await fill(query);
    const option = [...container.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent?.includes(path),
    );
    expect(option).toBeDefined();
    await act(async () =>
      option!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
  };
  return { container, click, render, dispose, choose, fill, input };
}

it('keeps a folder choice as a draft, then writes its stable link and title on Save', async () => {
  const commit = vi
    .fn<LinkEditRequest['commit']>()
    .mockResolvedValue({ status: 'completed' });
  const issue = vi.fn().mockResolvedValue('verd://folder/plan-id');
  const { container, click, choose, dispose } = await mount(
    { isCurrent: () => true, canInsertText: true, commit },
    issue,
  );
  try {
    await click('Edit selection');
    await choose('Plans', 'Plans');
    expect(issue).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    await click('Save');
    expect(issue).toHaveBeenCalledWith('Plans');
    expect(commit).toHaveBeenCalledWith(
      'verd://folder/plan-id',
      'Plans',
      expect.any(AbortSignal),
    );
    expect(container.querySelector('dialog')).toBeNull();
  } finally {
    await dispose();
  }
});

it('invalidates a pending folder save when its tab changes', async () => {
  const commit = vi.fn<LinkEditRequest['commit']>();
  const finish = vi.fn();
  let resolve!: (href: string) => void;
  const issue = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const { container, click, choose, render, dispose } = await mount(
    { isCurrent: () => true, commit, finish },
    issue,
  );
  try {
    await click('Edit selection');
    await choose('Plans', 'Plans');
    await click('Save');
    await render('second');
    await act(async () => resolve('verd://folder/plan-id'));
    expect(container.querySelector('dialog')).toBeNull();
    expect(finish).toHaveBeenCalledExactlyOnceWith('invalidated');
    expect(commit).not.toHaveBeenCalled();
  } finally {
    await dispose();
  }
});

it('recalls a moved cell by identity, with its current location and the original stored address', async () => {
  const href = 'verd://file/old#cell%3Anode';
  const commit = vi
    .fn<LinkEditRequest['commit']>()
    .mockResolvedValue({ status: 'completed' });
  const { container, click, dispose } = await mount(
    { href, isCurrent: () => true, commit },
    vi.fn(),
    [
      {
        href: 'verd://file/current#cell%3Anode',
        title: 'Review',
        detail: 'Design',
        path: 'Projects/Design.verd',
        kind: 'cell',
      },
      {
        href: 'verd://file/another#cell%3Adifferent',
        title: 'Review',
        detail: 'Other',
        path: 'Projects/Other.verd',
        kind: 'cell',
      },
    ],
  );
  try {
    await click('Edit selection');
    expect(
      container.querySelector<HTMLInputElement>('[role="combobox"]')?.value,
    ).toBe('Review');
    expect(
      container.querySelector('.workspace-link-location')?.textContent,
    ).toContain('Projects/Design.verd');
    await click('Save');
    expect(commit).toHaveBeenCalledWith(
      href,
      undefined,
      expect.any(AbortSignal),
    );
  } finally {
    await dispose();
  }
});

it('shows a missing target and allows choosing a replacement', async () => {
  const commit = vi
    .fn<LinkEditRequest['commit']>()
    .mockResolvedValue({ status: 'completed' });
  const { container, click, choose, dispose } = await mount(
    {
      href: 'verd://file/missing',
      canRemove: true,
      isCurrent: () => true,
      commit,
    },
    vi.fn(),
    [
      {
        href: 'verd://file/replacement',
        title: 'Replacement',
        detail: 'Folder/Replacement',
        kind: 'document',
      },
    ],
  );
  try {
    await click('Edit selection');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Target unavailable',
    );
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Save',
      )?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>('[role="combobox"]')?.value,
    ).toBe('verd://file/missing');
    await choose('Replacement', 'Folder/Replacement');
    expect(container.querySelector('[role="status"]')).toBeNull();
    await click('Save');
    expect(commit).toHaveBeenCalledWith(
      'verd://file/replacement',
      undefined,
      expect.any(AbortSignal),
    );
  } finally {
    await dispose();
  }
});

it('selects the intended same-name document by keyboard without committing the link', async () => {
  const commit = vi
    .fn<LinkEditRequest['commit']>()
    .mockResolvedValue({ status: 'completed' });
  const { click, fill, input, dispose } = await mount(
    { canInsertText: true, isCurrent: () => true, commit },
    vi.fn(),
    [
      { href: 'verd://file/a', title: 'Plan', detail: 'Archive/Plan' },
      { href: 'verd://file/b', title: 'Plan', detail: 'Current/Plan' },
    ],
  );
  try {
    await click('Edit selection');
    await fill('Plan');
    for (const key of ['ArrowDown', 'Enter'])
      await act(async () => {
        input().dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    expect(input().value).toBe('Plan');
    expect(commit).not.toHaveBeenCalled();
    await click('Save');
    expect(commit).toHaveBeenCalledWith(
      'verd://file/b',
      'Plan',
      expect.any(AbortSignal),
    );
  } finally {
    await dispose();
  }
});

it('requires Save to remove an existing link and uses an external address as new link text', async () => {
  const commit = vi
    .fn<LinkEditRequest['commit']>()
    .mockResolvedValue({ status: 'completed' });
  const { container, click, fill, dispose } = await mount(
    {
      href: 'https://example.com/old',
      canRemove: true,
      isCurrent: () => true,
      commit,
    },
    vi.fn(),
  );
  try {
    await click('Edit selection');
    await fill('');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Saving will remove the link',
    );
    expect(commit).not.toHaveBeenCalled();
    await click('Save');
    expect(commit).toHaveBeenCalledWith(
      null,
      undefined,
      expect.any(AbortSignal),
    );
  } finally {
    await dispose();
  }
  const next = await mount(
    { canInsertText: true, isCurrent: () => true, commit },
    vi.fn(),
  );
  try {
    await next.click('Edit selection');
    await next.fill('https://example.com/guide');
    await next.click('Save');
    expect(commit).toHaveBeenLastCalledWith(
      'https://example.com/guide',
      'https://example.com/guide',
      expect.any(AbortSignal),
    );
  } finally {
    await next.dispose();
  }
});
