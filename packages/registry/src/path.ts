/** A group index or named dependency edge. */
type PathStep =
  | readonly [edge: 'items', index: number]
  | readonly [edge: 'dependencies', name: string]

/**
 * An occurrence within one planning input, not an item identity. Traversal supplies
 * nonnegative root/group indices and named dependencies; the tuple requires a root.
 */
export type ItemPath = readonly [root: number, ...steps: PathStep[]]

/** Render structured provenance only at a human-readable diagnostic boundary. */
export function formatPath([root, ...steps]: ItemPath): string {
  return (
    `root[${root}]` +
    steps
      .map(
        ([edge, index]) =>
          `/${edge}[${edge === 'dependencies' ? JSON.stringify(index) : index}]`
      )
      .join('')
  )
}
