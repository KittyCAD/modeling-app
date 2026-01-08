import { useEffect, useRef } from 'react'
import { MARKED_OPTIONS } from '@src/lib/constants'
import { Marked } from '@ts-stack/markdown'
import { attachSafeLinkHandler, SafeRenderer } from '@src/lib/markdown'

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
