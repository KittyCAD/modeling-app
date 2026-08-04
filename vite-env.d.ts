/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly MODELING_APP_COMMIT_SHA?: string
}
