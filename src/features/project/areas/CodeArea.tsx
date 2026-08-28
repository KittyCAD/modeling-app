import { computed } from '@preact/signals'
import { useMemo } from 'preact/hooks'
import { useService } from '@src/app/context'
import { layoutService } from '@src/contracts/layout'
import { AreaHost } from '@src/features/layout/AreaHost'
import { inlineResizeHandlers } from '@src/features/layout/inlineResize'
import {
  CODE_FILES_EXTENT_ID,
  EXPLORER_AREA_ID,
} from '@src/features/project/areaIds'
import { EditorArea } from '@src/features/project/areas/EditorArea'
import '../project.css'

const MIN_FILES = 140
const MAX_FILES = 420

/**
 * The code panel: the editor, with the file tree beside it.
 *
 * The two are one region as far as the dock is concerned. Reading code and
 * choosing which code to read are the same activity, and the tree's only
 * consumer is the editor — so toggling "code" takes both away and leaves the
 * model with the whole window, which is the right default for a CAD app.
 *
 * The tree is still a contributed area, not a component call: its open state,
 * its width and its toggle command all belong to the layout service, and
 * `hostedBy` is the one bit of the contract that says "listed in the rail, drawn
 * in here". So a preset could still dock it on its own, and nothing here knows
 * how it is stored.
 */
export function CodeArea() {
  const layout = useService(layoutService)

  const files = layout.area(EXPLORER_AREA_ID)
  const filesOpen = layout.isAreaOpen(EXPLORER_AREA_ID)
  const extent = layout.extentFor(CODE_FILES_EXTENT_ID, 220)

  /**
   * Keyed on the signal's identity, not memoised on mount.
   *
   * `extentFor` hands out a fresh signal after a layout reset, and a computed
   * built once would keep reporting the old one. Signal-valued styles also mean
   * a drag frame is one attribute write rather than a re-render of the editor.
   */
  const filesStyle = useMemo(
    () => computed(() => `--zds-code-files:${extent.value}px`),
    [extent]
  )

  const resize = inlineResizeHandlers(extent, {
    // The strip is to the left of its handle, so rightward widens.
    direction: 1,
    min: MIN_FILES,
    max: MAX_FILES,
  })

  return (
    <div class="zds-code">
      {files && filesOpen.value ? (
        <div class="zds-code__files" style={filesStyle}>
          <AreaHost
            area={files}
            nodeId={CODE_FILES_EXTENT_ID}
            onClose={() => layout.closeArea(EXPLORER_AREA_ID)}
          />
          <div
            class="zds-code__handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize files"
            tabIndex={0}
            onPointerDown={resize.onPointerDown}
            onKeyDown={resize.onKeyDown}
          />
        </div>
      ) : null}

      <div class="zds-code__editor">
        <EditorArea />
      </div>
    </div>
  )
}
