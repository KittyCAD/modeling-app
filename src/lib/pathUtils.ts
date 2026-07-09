/**
 * Use this for only web related paths not paths in OS or on disk
 * e.g. document.location.pathname
 * WARNING (lee): THIS IS TRULY FOR ALL WEB USES, EVEN IN ELECTRON RENDERER!
 * I got bit hard by this.
 */
export function webSafePathSplit(targetPath: string): string[] {
  // eslint-disable-next-line no-restricted-syntax
  return targetPath.split('/')
}

export function webSafeJoin(paths: string[]): string {
  // eslint-disable-next-line no-restricted-syntax
  return paths.join('/')
}
