import type { SceneBrowserAppearance } from '@src/lib/sceneBrowser/registry/contract'
import { createContext } from 'react'

/** Browser contents can share its appearance without depending on the owning feature's settings. */
export const SceneBrowserAppearanceContext =
  createContext<SceneBrowserAppearance>('hud')
