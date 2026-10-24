/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_INTERACTION_PERFORMANCE?: '1'
  readonly MODELING_APP_COMMIT_SHA?: string
  readonly MODELING_APP_GIT_REF?: string
  readonly VERCEL_ENV?: 'development' | 'preview' | 'production'
}
