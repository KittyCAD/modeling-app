import { attachSafeLinkHandler, renderSafeMarkdown } from '@src/lib/markdown'
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
        __html: renderSafeMarkdown(text),
      }}
    ></span>
  )
}
