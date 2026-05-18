import env, { viteEnv } from '@src/env'
import { STAGING_BUILD_SUFFIX } from '@src/lib/appFolderName'

type ModeSketchDebugEnvironment = {
  nodeEnv?: string
  vercelEnv?: string
  baseDomain?: string
  packageName?: string
  packageVersion?: string
}

function getElectronPackageJson() {
  return typeof window !== 'undefined'
    ? (window.electron?.packageJson as
        | { name?: string; version?: string }
        | undefined)
    : null
}

export function getModeSketchDebugEnvironment(): ModeSketchDebugEnvironment {
  const packageJson = getElectronPackageJson()

  return {
    nodeEnv: env().NODE_ENV,
    vercelEnv: viteEnv().VERCEL_ENV,
    baseDomain: env().VITE_ZOO_BASE_DOMAIN,
    packageName: packageJson?.name,
    packageVersion: packageJson?.version,
  }
}

export function isModeSketchDebugExtensionsAvailable(
  environment: ModeSketchDebugEnvironment = getModeSketchDebugEnvironment()
) {
  return (
    environment.nodeEnv === 'development' ||
    environment.nodeEnv === 'test' ||
    environment.vercelEnv === 'preview' ||
    environment.baseDomain === 'dev.zoo.dev' ||
    environment.packageName?.includes(STAGING_BUILD_SUFFIX) === true ||
    environment.packageVersion === '0.0.0' ||
    environment.packageVersion === 'dev'
  )
}
