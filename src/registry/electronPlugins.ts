import { register as registerCura } from '@src/registry/plugins/curaSlicer/electron'
import { register as registerPrusa } from '@src/registry/plugins/prusaSlicer/electron'

/** Main-process entrypoints, kept separate from the renderer's module catalog. */
export const bundledElectronPluginRegistrations = [registerCura, registerPrusa]
