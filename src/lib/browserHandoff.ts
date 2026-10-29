import { parse } from 'smol-toml'
import { getAppFolderName } from '@src/lib/appFolderName'
import {
  ASK_TO_OPEN_QUERY_PARAM,
  SETTINGS_FILE_NAME,
  ZOO_STUDIO_PROTOCOL,
} from '@src/lib/constants'
import { resolveOPFSHandle } from '@src/lib/fs-zds/opfsHandle'
import { webSafeJoin } from '@src/lib/pathUtils'
import { Themes } from '@src/lib/theme'
import { isRecord } from '@src/lib/utils'
import { IS_STAGING, IS_STAGING_OR_DEBUG } from '@src/lib/appVersion'

export function shouldShowDesktopHandoff(search: string, desktop: boolean) {
  return !desktop && new URLSearchParams(search).has(ASK_TO_OPEN_QUERY_PARAM)
}

export function getDesktopHandoffUrl(url: URL) {
  return `${ZOO_STUDIO_PROTOCOL}://${url.pathname.replace('/', '')}${url.search}${url.hash}`
}

/** Preview only the persisted appearance; Rust still owns settings validation. */
export async function readDesktopHandoffTheme(): Promise<Themes | undefined> {
  try {
    const folder = getAppFolderName({
      packageName: 'zoo-modeling-app',
      platform: 'unknown',
      isStaging: IS_STAGING,
      isStagingOrDebug: IS_STAGING_OR_DEBUG,
    })
    const handle = await resolveOPFSHandle(
      webSafeJoin(['/appData', folder, SETTINGS_FILE_NAME])
    )
    if (!(handle instanceof FileSystemFileHandle)) return
    const file = await handle.getFile()
    const configuration = parse(await file.text())
    const settings = configuration.settings
    if (!isRecord(settings) || !isRecord(settings.app)) return
    const appearance = settings.app.appearance
    const theme =
      (isRecord(appearance) ? appearance.theme : undefined) ??
      settings.app.theme
    if (
      theme === Themes.Light ||
      theme === Themes.Dark ||
      theme === Themes.System
    )
      return theme
  } catch {
    // Missing or unreadable preferences must not prevent choosing the desktop
    // app. The normal bootstrap validates settings if the user chooses the web.
  }
}
