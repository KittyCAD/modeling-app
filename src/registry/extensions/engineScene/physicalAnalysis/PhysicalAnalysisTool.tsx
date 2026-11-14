import { LegacySceneToolsProvider } from '../LegacySceneToolsProvider'
import {
  PhysicalAnalysisToolView,
  PhysicalAnalysisStatusBarItemView,
  PhysicalAnalysisDraggablePanelView,
} from './PhysicalAnalysisToolView'
export function PhysicalAnalysisTool() {
  return (
    <LegacySceneToolsProvider>
      <PhysicalAnalysisToolView />
    </LegacySceneToolsProvider>
  )
}
export function PhysicalAnalysisStatusBarItem() {
  return (
    <LegacySceneToolsProvider>
      <PhysicalAnalysisStatusBarItemView />
    </LegacySceneToolsProvider>
  )
}
export function PhysicalAnalysisDraggablePanel(
  props: Parameters<typeof PhysicalAnalysisDraggablePanelView>[0]
) {
  return (
    <LegacySceneToolsProvider>
      <PhysicalAnalysisDraggablePanelView {...props} />
    </LegacySceneToolsProvider>
  )
}
