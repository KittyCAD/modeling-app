import electronUpdater, { type AppUpdater } from 'electron-updater'

export function getAutoUpdater(): AppUpdater {
  // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
  // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
  const { autoUpdater } = electronUpdater
  // Allows us to rollback to a previous version if needed.
  // See https://github.com/electron-userland/electron-builder/blob/7dbc6c77c340c869d1e7effa22135fc740003a0f/packages/electron-updater/src/AppUpdater.ts#L450-L451
  autoUpdater.allowDowngrade = true
  return autoUpdater
}
