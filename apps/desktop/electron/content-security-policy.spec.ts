import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  shouldAttachContentSecurityPolicy,
} from './content-security-policy';

describe('content security policy', () => {
  it('omits unsafe-eval in development and production', () => {
    expect(contentSecurityPolicy('http://localhost:7300/')).not.toContain(
      'unsafe-eval',
    );
    expect(contentSecurityPolicy()).not.toContain('unsafe-eval');
  });

  it('allows the vite client preamble and websocket only in development', () => {
    const dev = contentSecurityPolicy('http://localhost:7300/');
    expect(dev).toContain("script-src 'self' 'unsafe-inline'");
    expect(dev).toContain('ws://localhost:7300');

    const production = contentSecurityPolicy();
    expect(production).toContain("script-src 'self';");
    expect(production).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(production).toContain("style-src 'self' 'unsafe-inline'");
    expect(production).not.toContain('ws://');
  });

  it('attaches the policy to the app document and leaves other hosts alone', () => {
    const devServer = 'http://localhost:7300/';
    expect(
      shouldAttachContentSecurityPolicy(
        'http://localhost:7300/',
        'mainFrame',
        devServer,
      ),
    ).toBe(true);
    expect(
      shouldAttachContentSecurityPolicy(
        'http://localhost:7300/',
        'xhr',
        devServer,
      ),
    ).toBe(true);
    expect(
      shouldAttachContentSecurityPolicy(
        'http://localhost:7300/src/main.tsx',
        'script',
        devServer,
      ),
    ).toBe(false);
    expect(
      shouldAttachContentSecurityPolicy(
        'https://fonts.googleapis.com/css2?family=Assistant',
        'mainFrame',
        devServer,
      ),
    ).toBe(false);
    expect(
      shouldAttachContentSecurityPolicy(
        'file:///app/dist/index.html',
        'mainFrame',
      ),
    ).toBe(true);
  });
});
