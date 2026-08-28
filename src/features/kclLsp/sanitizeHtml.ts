/**
 * Hover content, made safe to insert.
 *
 * The client renders the server's Markdown to HTML and puts it in the document,
 * and its own configuration says why that needs a sanitizer: Markdown can carry
 * arbitrary HTML. The content is not as trustworthy as "our own server" makes it
 * sound — KCL doc comments end up in hovers, and a KCL file can arrive from
 * anywhere.
 *
 * Two implementations, and the fallback loses formatting rather than trust:
 *
 * - Where the platform has a sanitizer (Chromium, so every desktop build), it is
 *   used with its default configuration, which is maintained by people who do
 *   this for a living.
 * - Everywhere else, the markup is reduced to its text. A hover that renders as
 *   plain prose is a small loss; a hover that executes a script is not.
 *
 * A vetted library — DOMPurify — is the eventual answer for the web build, and is
 * a dependency decision rather than something to hand-roll here.
 */

interface SanitizerCapable {
  setHTML: (html: string) => void
  innerHTML: string
}

const hasSetHTML = (element: Element): element is Element & SanitizerCapable =>
  'setHTML' in element &&
  typeof (element as SanitizerCapable).setHTML === 'function'

export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') return ''

  const host = document.createElement('div')

  if (hasSetHTML(host)) {
    host.setHTML(html)
    return host.innerHTML
  }

  // Parsed rather than regex-stripped: the parser is the only thing that agrees
  // with the parser about where a tag ends.
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const text = parsed.body.textContent ?? ''

  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
