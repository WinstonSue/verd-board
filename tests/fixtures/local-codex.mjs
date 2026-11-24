#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('codex-cli 0.169.1');
  process.exit(0);
}
if (
  !args.includes('--ephemeral') ||
  !args.includes('--ignore-user-config') ||
  !args.includes('--ignore-rules') ||
  args[args.indexOf('--sandbox') + 1] !== 'read-only' ||
  args.at(-1) !== '-'
)
  throw new Error('Unexpected Codex arguments');

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
if (prompt.includes('fixture-malformed-events')) {
  console.log('not a JSONL event');
  process.exit(0);
}
if (prompt.includes('fixture-auth')) {
  console.error('401 Unauthorized');
  process.exit(1);
}
if (prompt.includes('fixture-failed')) process.exit(1);
if (prompt.includes('fixture-cancel')) {
  await writeFile('.verdscrolls/codex-fixture.pid', String(process.pid));
  console.log(JSON.stringify({ type: 'turn.started' }));
  setInterval(() => {}, 1000);
} else {
  const fileId = /"fileId": "([^"]+)"/.exec(prompt)?.[1];
  const selected = /"selection": "([^"]+)"/.exec(prompt)?.[1];
  const cellId = /cell%3A([^"]+)/.exec(prompt)?.[1];
  const operations = [];
  if (prompt.includes('fixture-edit'))
    operations.push({
      type: 'document.set',
      fileId,
      markdown: 'Reviewed Codex change',
    });
  if (
    prompt.includes('fixture-folder-edit') &&
    prompt.includes('"kind": "folder"')
  )
    operations.push({
      type: 'document.set',
      fileId: 'outside-folder',
      markdown: 'Reviewed cross-folder change',
    });
  if (prompt.includes('fixture-canvas') && cellId)
    operations.push({
      type: 'node.upsert',
      fileId,
      id: cellId,
      kind: 'geometry',
      label: prompt.includes('fixture-canvas-follow-up')
        ? 'Follow-up canvas change'
        : 'Reviewed canvas change',
    });
  const result = {
    answer: selected
      ? 'Codex read ' + selected
      : cellId
        ? 'Codex read ' + cellId
        : 'Codex ran in ' + process.cwd(),
    operationsJson: prompt.includes('fixture-invalid-operations')
      ? '[invalid operations'
      : operations.length
        ? JSON.stringify(operations)
        : null,
  };
  await writeFile(
    args[args.indexOf('--output-last-message') + 1],
    JSON.stringify(
      prompt.includes('fixture-invalid-result') ? { answer: 1 } : result,
    ),
  );
  const completed = JSON.stringify({ type: 'turn.completed' });
  process.stdout.write(completed.slice(0, 10));
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.stdout.write(completed.slice(10) + '\n');
}
