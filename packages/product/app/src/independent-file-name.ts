export function splitIndependentFileName(name: string) {
  const extension = /\.(?:verd\.json|verd|markdown|md)$/i.exec(name)?.[0] ?? '';
  return { stem: name.slice(0, name.length - extension.length), extension };
}
