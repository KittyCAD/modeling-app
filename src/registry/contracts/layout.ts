import type { ActionLibrary, AreaLibrary } from '@src/lib/layout/types'
import { defineContract, mergeObjectsValueSpec } from '@kittycad/registry'

export const layoutContract = defineContract({
  layoutAreaLibraryValueSpec: mergeObjectsValueSpec<AreaLibrary>(
    'layout.areaLibrary',
    {}
  ),
  layoutActionLibraryValueSpec: mergeObjectsValueSpec<ActionLibrary>(
    'layout.actionLibrary',
    {}
  ),
})

export const { layoutAreaLibraryValueSpec, layoutActionLibraryValueSpec } =
  layoutContract
