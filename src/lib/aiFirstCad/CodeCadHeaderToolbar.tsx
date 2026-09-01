import { ResponsiveCadHeaderToolbar } from '@src/lib/aiFirstCad/ResponsiveCadHeaderToolbar'

export function CodeCadHeaderToolbar() {
  return (
    <ResponsiveCadHeaderToolbar
      ariaLabel="More CodeCAD tools"
      panelTestId="code-cad-more-tools-panel"
      testId="code-cad-header-toolbar"
    />
  )
}
