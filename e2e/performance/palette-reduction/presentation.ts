export interface PresentationNode {
  tag: string
  attributes: Record<string, string>
  children: (PresentationNode | string)[]
}

export interface PaletteAppearance {
  geometry: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >
  styles: Record<string, Record<string, string>>
  optionCount: number
  autofocused: boolean
}

export interface PalettePresentation extends PaletteAppearance {
  sourceBuildRun: string | null
  sourceCommit: string | null
  provenance: string
  bodyClass: string
  colorScheme: string
  devicePixelRatio: number
  viewport: { width: number; height: number }
  launcher: PresentationNode
  wrapper: PresentationNode
  panel: PresentationNode
  assets: {
    stylesheets: { path: string; sha256: string }[]
    fonts: { path: string; sha256: string }[]
  }
}

// Self-contained for evaluation in the source and reduction renderers. The
// reduction calls this only after scoring has stopped.
export function readPaletteAppearance(): PaletteAppearance | null {
  const geometry: PaletteAppearance['geometry'] = {}
  const styles: PaletteAppearance['styles'] = {}
  const selectors = {
    launcher: '[data-testid="command-bar-open-button"]',
    wrapper: '[data-testid="command-bar-wrapper"]',
    transition: '[data-testid="command-bar-wrapper"] > div',
    panel: '[data-testid="command-bar"]',
    input: '[data-testid="cmd-bar-search"]',
    options: '[data-testid="command-bar"] [role="listbox"]',
    firstOption: '[data-testid="command-bar"] [role="option"]',
    tooltipSurface: '[data-testid="command-bar"] [role="tooltip"] > div',
  }
  for (const [name, selector] of Object.entries(selectors)) {
    const element = document.querySelector(selector)
    if (!element) return null
    if (name === 'launcher' || name === 'wrapper' || name === 'panel') {
      const { x, y, width, height } = element.getBoundingClientRect()
      geometry[name] = { x, y, width, height }
    }
    const computed = getComputedStyle(element)
    styles[name] = Object.fromEntries(
      [
        'background-color',
        'border-top-left-radius',
        'border-top-right-radius',
        'border-width',
        'border-color',
        'box-shadow',
        'filter',
        'font-family',
        'font-size',
        'font-weight',
        'line-height',
        'opacity',
        'overflow-y',
        'transform',
        'width',
        'height',
        'transition-property',
        'transition-duration',
        'transition-delay',
      ].map((property) => [property, computed.getPropertyValue(property)])
    )
  }
  return {
    geometry,
    styles,
    optionCount: document.querySelectorAll(
      '[data-testid="command-bar"] [role="option"]'
    ).length,
    autofocused:
      document.activeElement ===
      document.querySelector('[data-testid="cmd-bar-search"]'),
  }
}
