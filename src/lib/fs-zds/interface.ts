export interface IStat {
  dev: number
  ino: number
  /** Slight divergence from NodeJS stat. We don't support the string literals or null. */
  mode: number // 'read' | 'write' | 'execute' | null
  nlink: number
  uid: number
  gid: number
  rdev: number
  size: number
  blksize: number
  blocks: number
  atimeMs: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
  atime: Date
  mtime: Date
  ctime: Date
  birthtime: Date
}

/**
  * Common interface for swappable implementations of most NodeJS `fs` and `path` operations.
  * We built this so that our web and desktop targets (and any future targets) could perform I/O operations
  * to a common interface, and provide implementations that work on their platform.
*/
export interface IZooDesignStudioFS {
  resolve: (...strs: string[]) => string
  join: (...strs: string[]) => string
  relative: (...strs: string[]) => string
  extname: (str: string) => string
  sep: string
  basename: (...strs: string[]) => string
  dirname: (str: string) => string
  getPath: (type: 'appData' | 'documents' | 'userData') => Promise<string>
  access: (path: string, bitflags: number) => Promise<void>
  cp: (
    src: string,
    dest: string,
    options?: any
    // NodeJS website and TS type defs do not match. We need to use this.
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => Promise<undefined | void> | void
  readFile: ((src: string, options: { encoding: 'utf-8' }) => Promise<string>) &
    // I (lee) made this definition to satisfy other calls, but I'm pretty
    // sure 'utf8' is not a valid identifier...
    ((src: string, options: 'utf8') => Promise<string>) &
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    ((src: string, options?: {}) => Promise<Uint8Array>)
  rename: (
    src: string,
    dest: string,
    options?: any
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => Promise<void | undefined>
  writeFile: (
    src: string,
    data: Uint8Array<ArrayBuffer>,
    options?: any
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => Promise<undefined | void>
  readdir: (path: string, options?: any) => Promise<string[]>
  stat: (path: string, options?: any) => Promise<IStat>
  mkdir: (path: string, options?: any) => Promise<undefined | string>
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  rm: (path: string, options?: any) => Promise<undefined | void>
  /** Lifecycle hook for module, where additional resources can be gathered asynchronously if needed. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  detach: () => Promise<undefined | void>
  /** Lifecycle hook for module, where resources can be cleaned up asynchronously if needed. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  attach: () => Promise<undefined | void>
}
