import { isTauri } from 'lib/isTauri'
import { open as tauriOpen } from '@tauri-apps/plugin-shell'

// Open a new browser window tauri style or browser style.
export default async function openWindow(url: string) {
  if (isTauri()) {
    await tauriOpen(url)
  } else {
    window.open(url, '_blank')
  }
}
