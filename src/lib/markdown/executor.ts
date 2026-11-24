import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import { renderSafeMarkdown } from '@src/lib/markdown'

/** Markdown execution turns the editor snapshot into rendered HTML for preview. */
export const markdownExecutorCapability = defineExecutorCapability({
  id: 'markdown.render',
  matches: '.md',
  execute: (contents: string) => ({ html: renderSafeMarkdown(contents) }),
})
