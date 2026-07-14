import { defaultLayoutConfig } from '@src/lib/layout/configs/default'
import { zookeeperFocusConfig } from '@src/lib/layout/configs/zookeeperFocus'

/**
 * Layouts that can be loaded by the user at runtime
 * via the "Set layout" command.
 */
const userLoadableLayouts = Object.freeze({
  default: defaultLayoutConfig,
  zookeeper: zookeeperFocusConfig,
  ttc: zookeeperFocusConfig,
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
