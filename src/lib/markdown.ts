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

    // Attach a global function for non-react anchor elements that need safe navigation
    window.openExternalLink = (e: React.MouseEvent<HTMLAnchorElement>) => {
      openExternalBrowserIfDesktop()(e)
    }
  }

  // Extended from https://github.com/ts-stack/markdown/blob/c5c1925c1153ca2fe9051c356ef0ddc60b3e1d6a/packages/markdown/src/renderer.ts#L116
  link(href: string, title: string, text: string): string {
    if (this.options.sanitize) {
      let prot: string

      try {
        prot = decodeURIComponent(unescape(href))
          .replace(/[^\w:]/g, '')
          .toLowerCase()
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return text
      }

      if (
        // eslint-disable-next-line no-script-url
        prot.indexOf('javascript:') === 0 ||
        prot.indexOf('vbscript:') === 0 ||
        prot.indexOf('data:') === 0
      ) {
        return text
      }
    }

    let out =
      '<a onclick="openExternalLink(event)" target="_blank" href="' + href + '"'

    if (title) {
      out += ' title="' + title + '"'
    }

    out += '>' + text + '</a>'

    return out
  }
}
