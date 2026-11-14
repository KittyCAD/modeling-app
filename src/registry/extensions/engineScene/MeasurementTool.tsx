import { LegacySceneToolsProvider } from './LegacySceneToolsProvider'
import {
  MeasurementToolView,
  MeasurementStatusBarItemView,
  MeasurementDraggablePanelView,
} from './MeasurementToolView'
export function MeasurementTool() {
  return (
    <LegacySceneToolsProvider>
      <MeasurementToolView />
    </LegacySceneToolsProvider>
  )
}
export function MeasurementStatusBarItem() {
  return (
    <LegacySceneToolsProvider>
      <MeasurementStatusBarItemView />
    </LegacySceneToolsProvider>
  )
}
export function MeasurementDraggablePanel(
  props: Parameters<typeof MeasurementDraggablePanelView>[0]
) {
  return (
    <LegacySceneToolsProvider>
      <MeasurementDraggablePanelView {...props} />
    </LegacySceneToolsProvider>
  )
}
