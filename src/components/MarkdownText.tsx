import {
  MARKED_OPTIONS,
  SafeRenderer,
  attachSafeLinkHandler,
} from '@src/lib/markdown'
import { Marked } from '@ts-stack/markdown'
import { useEffect, useRef } from 'react'

export type MarkdownTextProps = {
  text: string
  className?: string
}

export function MarkdownText({ text, className }: MarkdownTextProps) {
  const markdownRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (markdownRef.current === null) return
    attachSafeLinkHandler(markdownRef.current)
  }, [])

  return (
    <span
      ref={markdownRef}
      className={`parsed-markdown inline-block ${className ?? ''}`}
      dangerouslySetInnerHTML={{
        __html: Marked.parse(text, {
          renderer: new SafeRenderer(MARKED_OPTIONS),
          ...MARKED_OPTIONS,
        }),
      }}
    ></span>
  )
}
