import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, closeHoverTooltips } from '@codemirror/view'

const closeButtonClass = 'cm-diagnosticClose'
const lintTooltipSelector = '.cm-tooltip-lint'
const tooltipSelector = '.cm-tooltip-hover.cm-tooltip'
const observedTooltipSelector = `${tooltipSelector}, ${lintTooltipSelector}`

class DiagnosticTooltipCloseButton {
  private observer: MutationObserver | null = null

  constructor(private view: EditorView) {
    if (
      typeof document === 'undefined' ||
      typeof MutationObserver === 'undefined'
    ) {
      return
    }

    this.observer = new MutationObserver((records) => {
      const hasTooltip = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof HTMLElement && node.matches(observedTooltipSelector)
        )
      )
      if (!hasTooltip) return

      this.addCloseButtons()
    })
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    })
    this.addCloseButtons()
  }

  destroy() {
    this.observer?.disconnect()
  }

  private addCloseButtons() {
    if (typeof document === 'undefined') return

    document
      .querySelectorAll<HTMLElement>(`${lintTooltipSelector} .cm-diagnostic`)
      .forEach((diagnostic) => {
        if (diagnostic.querySelector(`button.${closeButtonClass}`)) return

        const button = document.createElement('button')
        button.type = 'button'
        button.className = `cm-diagnosticAction ${closeButtonClass}`
        button.setAttribute('aria-label', 'Close diagnostic tooltip')

        const close = (event: Event) => {
          event.preventDefault()
          event.stopPropagation()
          // This only closes the hover tooltip state:
          this.view.dispatch({ effects: closeHoverTooltips })
          // gutter / parse-error lint tooltips removed manually
          button.closest(lintTooltipSelector)?.remove()
        }

        button.addEventListener('mousedown', close)
        button.addEventListener('click', close)
        diagnostic.append(button)
      })
  }
}

export function diagnosticTooltipCloseButton(): Extension {
  return [
    ViewPlugin.fromClass(DiagnosticTooltipCloseButton),
    EditorView.baseTheme({
      '.cm-tooltip-lint .cm-diagnostic': {
        position: 'relative',
        paddingRight: '1.75rem',
      },
      '.cm-tooltip-lint .cm-diagnosticAction.cm-diagnosticClose': {
        position: 'absolute',
        top: '0.25rem',
        right: '0.25rem',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1rem',
        height: '1rem',
        minWidth: '1rem',
        margin: '0',
        padding: '0',
        borderColor: 'transparent',
        background: 'transparent',
        color: 'inherit',
        fontSize: '0',
        lineHeight: '1',
      },
      '.cm-tooltip-lint .cm-diagnosticAction.cm-diagnosticClose::before': {
        content: '"x"',
        fontSize: '0.75rem',
        lineHeight: '1',
      },
      '.cm-tooltip-lint .cm-diagnosticAction.cm-diagnosticClose:hover, .cm-tooltip-lint .cm-diagnosticAction.cm-diagnosticClose:focus-visible':
        {
          backgroundColor: 'rgba(127, 127, 127, 0.18)',
        },
    }),
  ]
}
