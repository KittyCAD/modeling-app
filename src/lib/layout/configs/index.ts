import { defaultLayoutConfig } from '@src/lib/layout/configs/default'
import { textToCADFocusConfig } from '@src/lib/layout/configs/textToCADFocus'

/**
 * Layouts that can be loaded by the user at runtime
 * via the "Set layout" command.
 */
const userLoadableLayouts = Object.freeze({
  default: defaultLayoutConfig,
  ttc: textToCADFocusConfig,
})

function isUserLoadableLayoutKey(
  s?: unknown
): s is keyof typeof userLoadableLayouts {
  return (
    s !== undefined &&
    typeof s === 'string' &&
    Object.keys(userLoadableLayouts).includes(s)
  )
}

export { userLoadableLayouts, isUserLoadableLayoutKey }
