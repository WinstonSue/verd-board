import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function setServiceTarget(child, origin, timeout = 10000) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Frontend did not acknowledge service target')),
      timeout,
    );
    const exited = () => finish(new Error('Frontend exited'));
    const message = (value) => {
      if (value?.type === 'target' && value.id === id) finish();
    };
    function finish(error) {
      clearTimeout(timer);
      child.off('exit', exited);
      child.off('message', message);
      if (error) reject(error);
      else resolve();
    }
    child.once('exit', exited);
    child.on('message', message);
    child.send({ type: 'target', id, origin }, (error) => {
      if (error) finish(error);
    });
  });
}

export function webE2EOptions(env = process.env) {
  const fixed = Boolean(
    env.BASE_URL || env.VERDBOARD_WEB_PORT || env.VERDBOARD_SERVICE_PORT,
  );
  const workers = Number(env.VERD_WEB_E2E_WORKERS ?? (fixed ? 1 : 2));
  if (!Number.isInteger(workers) || workers < 1)
    throw new Error('VERD_WEB_E2E_WORKERS must be a positive integer');
  assertWebWorkers(workers, fixed);
  const port = (value) => {
    const parsed = Number(value ?? 0);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535)
      throw new Error('Invalid Web E2E port: ' + value);
    return parsed;
  };
  const url = env.BASE_URL ? new URL(env.BASE_URL) : undefined;
  return {
    workers,
    fixed,
    webPort: port(url ? url.port || 80 : env.VERDBOARD_WEB_PORT),
    servicePort: port(env.VERDBOARD_SERVICE_PORT),
    hostname: url?.hostname ?? '127.0.0.1',
  };
}

export function assertWebWorkers(workers, fixed) {
  if (fixed && workers !== 1)
    throw new Error(
      'Fixed Web E2E addresses require one worker; remove BASE_URL/VERDBOARD_WEB_PORT/VERDBOARD_SERVICE_PORT for parallel tests',
    );
}

/** Readiness belongs to this child, never to an unrelated listener on its port. */
export async function startReadyProcess(
  program,
  args,
  { cwd, env, port = 0, timeout = 24000 } = {},
) {
  const child = spawn(program, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => (logs += chunk));
  child.stderr.on('data', (chunk) => (logs += chunk));
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  };
  process.once('exit', kill);
  child.once('exit', () => process.removeListener('exit', kill));
  let stopping;
  const stop = () => {
    stopping ??= new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
        resolve();
        return;
      }
      const timer = setTimeout(kill, 10000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
    return stopping;
  };
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Child did not become ready')),
        timeout,
      );
      const exited = (code, signal) =>
        finish(new Error(`Child exited during startup (${code ?? signal})`));
      const message = (value) => {
        if (value?.type !== 'ready') return;
        if (
          !Number.isInteger(value.port) ||
          value.port < 1 ||
          value.port > 65535 ||
          (port && value.port !== port)
        )
          finish(new Error('Child reported an unexpected port'));
        else finish(undefined, value);
      };
      function finish(error, value) {
        clearTimeout(timer);
        child.off('error', finish);
        child.off('exit', exited);
        child.off('message', message);
        if (error) reject(error);
        else resolve(value);
      }
      child.once('error', finish);
      child.once('exit', exited);
      child.on('message', message);
    });
    return {
      child,
      ready,
      stop,
      get logs() {
        return logs;
      },
    };
  } catch (error) {
    await stop();
    process.removeListener('exit', kill);
    throw new Error(`${error.message}\n${logs}`, { cause: error });
  }
}
