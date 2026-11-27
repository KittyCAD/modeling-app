import { useLegacySceneToolsHost } from '../useLegacySceneToolsHost'
import {
  PhysicalAnalysisToolView,
  PhysicalAnalysisStatusBarItemView,
  PhysicalAnalysisDraggablePanelView,
} from './PhysicalAnalysisToolView'
export function PhysicalAnalysisTool() {
  const host = useLegacySceneToolsHost()
  return <PhysicalAnalysisToolView host={host} />
}
export function PhysicalAnalysisStatusBarItem() {
  const host = useLegacySceneToolsHost()
  return <PhysicalAnalysisStatusBarItemView host={host} />
}
export function PhysicalAnalysisDraggablePanel(
  props: Omit<Parameters<typeof PhysicalAnalysisDraggablePanelView>[0], 'host'>
) {
  const host = useLegacySceneToolsHost()
  return <PhysicalAnalysisDraggablePanelView {...props} host={host} />
}
