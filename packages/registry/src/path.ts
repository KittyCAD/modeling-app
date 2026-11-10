/** A declared graph edge and its index in the selected sequence. */
type PathStep = readonly [edge: 'items' | 'dependencies', index: number]

/**
 * An occurrence within one planning input, not an item identity. Traversal supplies
 * nonnegative integer indices; the tuple requires a root and only declared edges.
 */
export type ItemPath = readonly [root: number, ...steps: PathStep[]]

/** Render structured provenance only at a human-readable diagnostic boundary. */
export function formatPath([root, ...steps]: ItemPath): string {
  return (
    `root[${root}]` +
    steps.map(([edge, index]) => `/${edge}[${index}]`).join('')
  )
}
