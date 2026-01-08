import { useEffect, useRef } from 'react'
import type { MarkedOptions } from '@ts-stack/markdown'
import { Renderer, unescape } from '@ts-stack/markdown'
import { MARKED_OPTIONS } from '@src/lib/constants'
import { Marked } from '@ts-stack/markdown'

import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

/**
 * Main goal of this custom renderer is to prevent links from changing the current location
 * this is specially important for the desktop app.
 */
class SafeRenderer extends Renderer {
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
function attachSafeLinkHandler(root: Document | HTMLElement = document) {
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const anchor = target.closest<HTMLAnchorElement>('a[data-safe-link]')
    if (!anchor) return
    openExternalBrowserIfDesktop(anchor.href)(
      e as unknown as React.MouseEvent<HTMLAnchorElement>
    )
  })
}

export type MarkdownTextProps = {
  text: string
  className?: string
}

export function MarkdownText({ text, className }: MarkdownTextProps) {
  const markdownRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (markdownRef.current === null) return
    attachSafeLinkHandler(markdownRef.current)
  })

  return (
    <span
      ref={markdownRef}
      className={`parsed-markdown ${className ?? ''}`}
      dangerouslySetInnerHTML={{
        __html: Marked.parse(text, {
          renderer: new SafeRenderer(MARKED_OPTIONS),
          ...MARKED_OPTIONS,
        }),
      }}
    ></span>
  )
}
