import type { MarkedOptions } from '@ts-stack/markdown'
import { Marked, Renderer, escape, unescape } from '@ts-stack/markdown'

import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export const MARKED_OPTIONS: MarkedOptions = {
  gfm: true,
  breaks: true,
  smartLists: true,
  sanitize: true,
  unescape,
  escape,
}

export function renderSafeMarkdown(markdown: string): string {
  return Marked.parse(markdown, {
    renderer: new SafeRenderer(MARKED_OPTIONS),
    ...MARKED_OPTIONS,
  })
}

export function markdownMessageElement(message: string): HTMLElement {
  const element = document.createElement('div')
  element.className = 'parsed-markdown'
  element.innerHTML = renderSafeMarkdown(message)
  attachSafeLinkHandler(element)
  return element
}

/** Command descriptions use plain text, not Markdown formatting or link URLs. */
export function markdownToPlainText(markdown: string): string {
  const template = document.createElement('template')
  template.innerHTML = Marked.parse(markdown, MARKED_OPTIONS)
  return template.content.textContent?.trim() ?? ''
}

/**
 * Main goal of this custom renderer is to prevent links from changing the current location
 * this is specially important for the desktop app.
 */
export class SafeRenderer extends Renderer {
  constructor(options: MarkedOptions) {
    super(options)
  }

  link(href: string, title: string, text: string): string {
    if (this.options.sanitize) {
      let prot: string

      try {
        prot = decodeURIComponent(unescape(href))
          .replace(/[^\w:]/g, '')
          .toLowerCase()
      } catch {
        return text
      }

      if (
        prot.startsWith('javascript:') ||
        prot.startsWith('vbscript:') ||
        prot.startsWith('data:')
      ) {
        return text
      }
    }

    let out =
      '<a data-safe-link target="_blank" rel="noopener noreferrer" href="' +
      href +
      '"'

    if (title) {
      out += ' title="' + title + '"'
    }

    out += '>' + text + '</a>'

    return out
  }
}

/*
 * From https://github.com/KittyCAD/modeling-app/issues/9403#issuecomment-3718304883:
 * Intercept clicks, find the nearby data-safe-link anchor, retrieve the href link,
 * and properly fire openExternalBrowserIfDesktop
 */
export function attachSafeLinkHandler(root: HTMLElement) {
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) {
      return
    }

    const anchor = target.closest<HTMLAnchorElement>('a[data-safe-link]')
    if (!anchor) {
      return
    }

    openExternalBrowserIfDesktop(anchor.href)(
      e as unknown as React.MouseEvent<HTMLAnchorElement>
    )
  })
}
