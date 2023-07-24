/**
 * Takes an element id and creates a CSS clip-path rule to apply to a backdrop element
 * which excludes the element with the given id, creating a "highlight" effect.
 * @param highlightId
 */
export function createBackdropHighlight(highlightId: string): string {
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    const highlightElement = document.getElementById(highlightId)
    if (!highlightElement) {
        throw new Error(`Element with id ${highlightId} not found`)
    }

    const r = highlightElement.getBoundingClientRect()

    return `
    path(evenodd, "M0 0 l${windowWidth} 0 l0 ${windowHeight} l-${windowWidth} 0 Z \
        M${r.left} ${r.top} l${r.width} 0 l0 ${r.height} l-${r.width} 0 Z")
    `
}