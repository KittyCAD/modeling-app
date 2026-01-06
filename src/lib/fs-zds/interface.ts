export interface IStat {
  dev: number
  ino: number
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

export interface IZooDesignStudioFS {
  getPath: (type: 'appData' | 'documents' | 'userData') => Promise<string>
  access: (path: string, bitflags: number) => Promise<void>
  cp: (
    src: string,
    dest: string,
    options?: any
  ) => Promise<undefined | void> | void
  readFile: ((src: string, options: { encoding: 'utf-8' }) => Promise<string>) &
    // I (lee) made this definition to satisfy other calls, but I'm pretty
    // sure 'utf8' is not a valid identifier...
    ((src: string, options: 'utf8') => Promise<string>) &
    ((src: string, options?: {} | undefined) => Promise<Uint8Array>)
  rename: (src: string, dest: string, options?: any) => Promise<undefined>
  writeFile: (
    src: string,
    data: Uint8Array<ArrayBuffer>,
    options?: any
  ) => Promise<undefined>
  readdir: (path: string, options?: any) => Promise<string[]>
  stat: (path: string, options?: any) => Promise<IStat>
  mkdir: (path: string, options?: any) => Promise<undefined | string>
  rm: (path: string, options?: any) => Promise<undefined | void>
  detach: () => Promise<undefined | void>
  attach: () => Promise<undefined | void>
}
