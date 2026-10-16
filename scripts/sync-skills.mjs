#!/usr/bin/env node

/**
 * Thin wrapper around @ylib/ai-config-manager sync.
 * CI skips network; local postinstall / `pnpm skills:sync` pull and link.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject, syncBindings } from '@ylib/ai-config-manager';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warning: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };
  const prefix = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };
  console.log(`${colors[type]}${prefix[type]} ${message}${colors.reset}`);
}

async function main() {
  if (process.env.CI) {
    log('CI 环境跳过 skills 同步', 'info');
    return;
  }

  initProject(projectRoot);
  const report = await syncBindings(projectRoot, {
    proxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy,
  });

  if (report.updated.length) {
    log(`updated: ${report.updated.join(', ')}`, 'success');
  }
  if (report.unchanged.length) {
    log(`unchanged: ${report.unchanged.join(', ')}`);
  }
  if (report.removed.length) {
    log(`removed: ${report.removed.join(', ')}`, 'success');
  }
  if (report.unlinked.length) {
    log(`unlinked: ${report.unlinked.join(', ')}`, 'success');
  }
  if (report.skipped.length) {
    log(`skipped: ${report.skipped.join('; ')}`, 'warning');
  }
  if (report.errors.length) {
    throw new Error(`skills sync errors: ${report.errors.join('; ')}`);
  }

  log('skills 同步完成', 'success');
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error), 'error');
  process.exit(1);
});
