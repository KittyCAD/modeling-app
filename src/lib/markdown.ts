import type { MarkedOptions } from '@ts-stack/markdown'
import { Renderer, unescape } from '@ts-stack/markdown'

import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

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

// From https://github.com/KittyCAD/modeling-app/issues/9403#issuecomment-3718304883
export function attachSafeLinkHandler(root: Document | HTMLElement = document) {
  root.addEventListener('click', (e) => {
    console.log('safe link handler triggered')
    const target = e.target as HTMLElement | null
    if (!target) return

    const anchor = target.closest<HTMLAnchorElement>('a[data-safe-link]')
    if (!anchor) return

    openExternalBrowserIfDesktop()(
      e as unknown as React.MouseEvent<HTMLAnchorElement>
    )
  })
}
