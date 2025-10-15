import { throttle } from '@src/lib/utils'
import type { Layout, LayoutWithMetadata } from '@src/lib/layout/types'
import { LAYOUT_PERSIST_PREFIX, LAYOUT_SAVE_THROTTLE } from '@src/lib/constants'

interface ISaveLayout {
  layout: Layout
  layoutName?: string
  saveFn?: (key: string, value: string) => void | Promise<void>
}

/**
 * Wrap the layout data in a versioned object
 * and save it to persisted storage.
 */
function saveLayoutInner({ layout, layoutName = 'default' }: ISaveLayout) {
  return localStorage.setItem(
    `${LAYOUT_PERSIST_PREFIX}${layoutName}`,
    JSON.stringify({
      version: 'v1',
      layout,
    } satisfies LayoutWithMetadata)
  )
}
export const saveLayout = throttle(saveLayoutInner, LAYOUT_SAVE_THROTTLE)
