import type { VALID_PANE_IDS } from '@src/lib/constants'

/** TODO: Get rid of this in favor of DefaultLayoutPaneID
 * (and then eventually `string` when extensions can register areaTypes).
 *
 * Updating this to DefaultLayoutPaneID requires tiny changes
 * all over our Playwright tests from a string to an enum.
 */
export type SidebarId = (typeof VALID_PANE_IDS)[number]
