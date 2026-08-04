/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly MODELING_APP_RELEASE_TAG?: string
  readonly VERCEL_GIT_COMMIT_SHA?: string
}
