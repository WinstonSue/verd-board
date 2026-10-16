const SHARED_DIRECTIVES = [
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
];

export function contentSecurityPolicy(devServerUrl?: string): string {
  if (devServerUrl) {
    const origin = new URL(devServerUrl).origin;
    const websocket = origin.replace(/^http/i, 'ws');
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      ...SHARED_DIRECTIVES,
      `connect-src 'self' ${origin} ${websocket}`,
    ].join('; ');
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    ...SHARED_DIRECTIVES,
    "connect-src 'self'",
  ].join('; ');
}

export function shouldAttachContentSecurityPolicy(
  url: string,
  resourceType: string,
  devServerUrl?: string,
): boolean {
  if (!isAppUrl(url, devServerUrl)) {
    return false;
  }
  if (resourceType === 'mainFrame') {
    return true;
  }
  // Electron re-fetches the document to decide whether to warn about CSP.
  return isAppDocumentUrl(url, devServerUrl);
}

function isAppUrl(url: string, devServerUrl?: string): boolean {
  if (url.startsWith('file:')) {
    return true;
  }
  if (!devServerUrl) {
    return false;
  }
  try {
    return new URL(url).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

function isAppDocumentUrl(url: string, devServerUrl?: string): boolean {
  if (url.startsWith('file:')) {
    return url.split('?')[0].endsWith('.html');
  }
  if (!devServerUrl) {
    return false;
  }
  try {
    const target = new URL(url);
    const devServer = new URL(devServerUrl);
    return (
      target.origin === devServer.origin &&
      (target.pathname === '/' || target.pathname.endsWith('.html'))
    );
  } catch {
    return false;
  }
}
