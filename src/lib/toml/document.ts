import type { ChangeSpec } from '@codemirror/state'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { parseTOML, traverseNodes, type AST } from 'toml-eslint-parser'
import { isErr } from '@src/lib/trap'

/** A semantic address includes array indices as well as table and dotted keys. */
export type TomlPath = readonly (string | number)[]
export type EditableTomlValue = string | number | bigint | boolean

export function readToml(contents: string): TomlTable | Error {
  try {
    return parse(contents, { integersAsBigInt: 'asNeeded' })
  } catch (error) {
    return isErr(error) ? error : new Error(String(error))
  }
}

function keyPath(node: AST.TOMLKeyValue): TomlPath {
  const owner = node.parent
  const prefix =
    owner.type === 'TOMLTable'
      ? owner.resolvedKey
      : owner.type === 'TOMLInlineTable'
        ? valuePath(owner)
        : []
  return [
    ...prefix,
    ...node.key.keys.map((key) =>
      key.type === 'TOMLBare' ? key.name : key.value
    ),
  ]
}

function valuePath(node: AST.TOMLContentNode): TomlPath {
  const owner = node.parent
  return owner.type === 'TOMLKeyValue'
    ? keyPath(owner)
    : [...valuePath(owner), owner.elements.indexOf(node)]
}

/** Replace only the addressed literal in the current source, preserving comments and formatting. */
export function editToml(
  contents: string,
  path: TomlPath,
  value: EditableTomlValue
): ChangeSpec | Error {
  const parsed = readToml(contents)
  if (isErr(parsed)) return parsed
  try {
    let range: [number, number] | undefined
    traverseNodes(parseTOML(contents), {
      enterNode(node) {
        if (node.type !== 'TOMLValue') return
        const candidate = valuePath(node)
        if (
          candidate.length === path.length &&
          candidate.every((part, index) => part === path[index])
        )
          range = node.range
      },
      leaveNode() {},
    })
    if (!range)
      return new Error('This setting no longer exists. Check the TOML source.')
    const insert = stringify({ value }).slice('value = '.length).trimEnd()
    const updated =
      contents.slice(0, range[0]) + insert + contents.slice(range[1])
    const result = readToml(updated)
    if (isErr(result)) return result
    return { from: range[0], to: range[1], insert }
  } catch (error) {
    return isErr(error) ? error : new Error(String(error))
  }
}
