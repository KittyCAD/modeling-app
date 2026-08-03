/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VERCEL_GIT_COMMIT_REF?: string
  readonly VERCEL_GIT_COMMIT_SHA?: string
}
