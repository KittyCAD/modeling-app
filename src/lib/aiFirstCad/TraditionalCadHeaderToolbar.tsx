import { ResponsiveCadHeaderToolbar } from '@src/lib/aiFirstCad/ResponsiveCadHeaderToolbar'

export function TraditionalCadHeaderToolbar() {
  return (
    <ResponsiveCadHeaderToolbar
      ariaLabel="More TradCAD tools"
      panelTestId="trad-cad-more-tools-panel"
      testId="trad-cad-header-toolbar"
    />
  )
}
