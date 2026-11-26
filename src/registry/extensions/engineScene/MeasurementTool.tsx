import { useLegacySceneToolsHost } from './useLegacySceneToolsHost'
import {
  MeasurementToolView,
  MeasurementStatusBarItemView,
  MeasurementDraggablePanelView,
} from './MeasurementToolView'
export function MeasurementTool() {
  const host = useLegacySceneToolsHost()
  return <MeasurementToolView host={host} />
}
export function MeasurementStatusBarItem() {
  const host = useLegacySceneToolsHost()
  return <MeasurementStatusBarItemView host={host} />
}
export function MeasurementDraggablePanel(
  props: Omit<Parameters<typeof MeasurementDraggablePanelView>[0], 'host'>
) {
  const host = useLegacySceneToolsHost()
  return <MeasurementDraggablePanelView {...props} host={host} />
}
