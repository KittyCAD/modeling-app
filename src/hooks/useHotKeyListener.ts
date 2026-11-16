import type { KclManager } from '@src/lang/KclManager'
import { useEffect } from 'react'
import { trackSelectionModifiers } from '@src/lib/selectionModifiers'
// Kurt's note: codeMirror styling overrides were needed to make this work
// namely, the cursor needs to still be shown when the editor is not focused
// search for code-mirror-override in the repo to find the relevant styles

/**
 * @deprecated Prefer registering shortcuts through `keymapFacet`.
 */
export function useHotKeyListener(kclManager: KclManager) {
  useEffect(() => trackSelectionModifiers(kclManager), [kclManager])
}
