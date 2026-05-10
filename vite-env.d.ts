/// <reference types="vite/client" />

declare const __APP_VERSION__: string

declare module 'opencascade.js/dist/node.js' {
  type OpenCascadeInitOptions = {
    mainJS?: unknown
    mainWasm?: string
    worker?: unknown
    libs?: unknown[]
    module?: Record<string, unknown>
  }

  const initOpenCascade: (options?: OpenCascadeInitOptions) => Promise<any>

  export default initOpenCascade
}

declare module 'opencascade.js/dist/opencascade.full.js' {
  type OpenCascadeModuleOptions = {
    locateFile?: (path: string, scriptDirectory?: string) => string
    [key: string]: unknown
  }

  const OpenCascadeMain: (options?: OpenCascadeModuleOptions) => Promise<any>

  export default OpenCascadeMain
}
