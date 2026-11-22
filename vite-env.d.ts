/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_DEV_ACCOUNT_APP_CONFIG?: '1'
  readonly VITE_INTERACTION_PERFORMANCE?: '1'
  readonly MODELING_APP_COMMIT_SHA?: string
  readonly VERCEL_ENV?: 'development' | 'preview' | 'production'
}

declare const __APP_STARTUP_COMPOSITION__: import('./src/registry/startupComposition').AppStartupComposition
