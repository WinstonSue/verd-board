import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { configureApplicationIdentity } from './application-identity';

const setup = (isPackaged: boolean, initial = '/data/VerdBoard') => ({
  isPackaged,
  getPath: (name: 'appData' | 'userData') =>
    name === 'appData' ? '/data' : initial,
  setPath: vi.fn(),
  setName: vi.fn(),
});

describe('desktop application identity', () => {
  it('fixes packaged identity and data even when an old package used desktop', () => {
    const app = setup(true, '/data/desktop');
    expect(configureApplicationIdentity(app, {})).toEqual({
      legacyUserDataRoot: '/data/desktop',
    });
    expect(app.setName).toHaveBeenCalledWith('VerdBoard');
    expect(app.setPath).toHaveBeenCalledWith('userData', '/data/VerdBoard');
  });

  it.each([
    '/data/VerdBoard',
    '/data/desktop',
    '/data/VerdBoard Dev',
    '/data/Electron',
  ])(
    'keeps development out of current and legacy production data (%s)',
    (initial) => {
      const app = setup(false, initial);
      expect(configureApplicationIdentity(app, {})).toEqual({});
      expect(app.setName).toHaveBeenCalledWith('VerdBoard Dev');
      expect(app.setPath).toHaveBeenCalledWith(
        'userData',
        '/data/VerdBoard Dev',
      );
    },
  );

  it('preserves an unpackaged test launcher path', () => {
    const app = setup(false, '/isolated/test');
    configureApplicationIdentity(app, {
      VITE_DEV_SERVER_URL: 'http://localhost:7310',
    });
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('keeps packaged identity independent of the renderer URL', () => {
    const app = setup(true);
    configureApplicationIdentity(app, {
      VITE_DEV_SERVER_URL: 'http://localhost:7310',
    });
    expect(app.setName).toHaveBeenCalledWith('VerdBoard');
    expect(app.setPath).toHaveBeenCalledWith('userData', '/data/VerdBoard');
  });

  it('isolates packaged tests and legacy recovery together', () => {
    const app = setup(true);
    const userData = path.resolve('/isolated/VerdBoard');
    expect(
      configureApplicationIdentity(app, { VERDBOARD_USER_DATA_PATH: userData }),
    ).toEqual({ legacyUserDataRoot: '/isolated/desktop' });
    expect(app.setPath).toHaveBeenCalledWith('userData', userData);
  });

  it('honors an explicit development data path without importing old history', () => {
    const app = setup(false);
    expect(
      configureApplicationIdentity(app, {
        VERDBOARD_USER_DATA_PATH: '/isolated/development',
        VITE_DEV_SERVER_URL: 'http://localhost:7310',
      }),
    ).toEqual({});
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      '/isolated/development',
    );
  });
});
