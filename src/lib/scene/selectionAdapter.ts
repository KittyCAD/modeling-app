import type { EntityType } from '@kittycad/lib'
import { effect } from '@preact/signals-core'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { sendQueryEntityTypeWithPointFromSceneClick } from '@src/lib/scene/picking'
import type {
  SceneSelectionController,
  SelectionAdapter,
  SelectionModel,
} from '@src/lib/scene/selection'
import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import styles from './selectionAdapter.module.css'

// TODO(Rendering API): Zoo streaming lacks arbitrary independently owned entity-styling groups
// with configurable color/opacity and overlap precedence. The app should use that generic
// capability for selection, hover, or correspondence; the renderer need not know those semantics.
// Do not repurpose hover or recolor model materials to simulate independent styling groups.
/** Project selection state onto the existing engine protocol; local rendering intercepts the same commands. */
export function sceneSelectionAdapter(
  commands: Pick<ConnectionManager, 'sendSceneCommand' | 'streamDimensions'>,
  canvas: HTMLCanvasElement
): SelectionAdapter {
  const send: ConnectionManager['sendSceneCommand'] = (
    request,
    forceWebsocket
  ) => commands.sendSceneCommand(request, forceWebsocket)
  let appliedFilter:
    | { model: SelectionModel; values: readonly EntityType[] }
    | undefined
  return {
    pick: (point) =>
      sendQueryEntityTypeWithPointFromSceneClick(point, canvas, commands),
    present: async (references, filter, isCurrent, model) => {
      if (!isCurrent()) return
      const filterChanged =
        appliedFilter?.model !== model ||
        appliedFilter.values.length !== filter.length ||
        appliedFilter.values.some((value, index) => value !== filter[index])
      if (filterChanged) {
        await send({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'set_selection_filter', filter: [...filter] },
        })
        if (!isCurrent()) return
        appliedFilter = { model, values: [...filter] }
      }
      if (!isCurrent()) return
      // The legacy setEngineEntitySelectionV2 path also relies on full-set replacement.
      // Clearing first exposes a blank selection in the video stream.
      await send({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: references.length
          ? { type: 'select_entity', entities: [...references] }
          : { type: 'select_clear' },
      })
    },
  }
}

/** CameraControls retains gesture/hover handling; this attachment adds primary-click selection and keyboard clearing. */
export function attachSceneSelectionInput(
  canvas: HTMLCanvasElement,
  controls: Pick<CameraControls, 'wasDragging' | 'hoverPickingDisabled'>,
  selection: SceneSelectionController
) {
  const previousTabIndex = canvas.getAttribute('tabindex')
  const hadFocusStyle = canvas.classList.contains(styles.pickingSurface)
  canvas.classList.add(styles.pickingSurface)
  canvas.tabIndex = 0
  const down = () => {
    canvas.focus({ preventScroll: true })
  }
  const up = (event: PointerEvent) => {
    if (event.button !== 0 || controls.wasDragging || event.defaultPrevented)
      return
    void selection.pick(event, event.shiftKey).catch(reportRejection)
  }
  const key = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !selection.dialogOpen.peek()
    )
      selection.clear()
  }
  const stop = effect(() => {
    controls.hoverPickingDisabled = !selection.pickingEnabled.value
  })
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('keydown', key)
  return () => {
    stop()
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('keydown', key)
    if (!hadFocusStyle) canvas.classList.remove(styles.pickingSurface)
    if (previousTabIndex === null) canvas.removeAttribute('tabindex')
    else canvas.setAttribute('tabindex', previousTabIndex)
  }
}
