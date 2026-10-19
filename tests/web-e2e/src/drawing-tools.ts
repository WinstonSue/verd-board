import { type Page } from '@playwright/test';

const groupedTools: Record<string, string> = {
  箭头: '连线',
  双向箭头: '连线',
  直线: '连线',
  曲线: '连线',
  Arrow: 'Connectors',
  Line: 'Connectors',
  Curve: 'Connectors',
  思维导图: '图表',
  流程图: '图表',
  架构图: '图表',
  'UML 类图': '图表',
  'UML 时序图': '图表',
  'UML Class Diagram': 'Diagrams',
  'UML Sequence Diagram': 'Diagrams',
  'Mind Map': 'Diagrams',
  Flowchart: 'Diagrams',
  Architecture: 'Diagrams',
};

export async function selectDrawingTool(page: Page, label: string) {
  const toolbar = page.getByRole('toolbar', { name: 'Drawing tools' });
  const group = groupedTools[label];
  if (group) {
    const trigger = toolbar.getByRole('button', { name: group, exact: true });
    if ((await trigger.getAttribute('aria-expanded')) !== 'true')
      await trigger.click();
    await page
      .getByRole('menu', { name: group, exact: true })
      .getByRole('menuitemradio', { name: label, exact: true })
      .click();
    return;
  }
  if (label === '折线' || label === 'Polyline') {
    await toolbar
      .getByRole('button', {
        name: label === '折线' ? '形状' : 'Shape',
        exact: true,
      })
      .click();
  }
  await (
    label === '折线' || label === 'Polyline'
      ? page.getByRole('dialog')
      : toolbar
  )
    .getByRole('button', { name: label, exact: true })
    .click();
}
