import type { instance } from '@viz-js/viz'
import { ChangeSet, Text } from '@codemirror/state'
import { z } from 'zod'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import {
  readDot,
  insertStatement,
  type DotDocument,
  type Point,
  type SourceRange,
  positionChanges,
} from '@src/lib/dot/document'
import { isErr } from '@src/lib/trap'

export type Endpoint = string | Point
export interface GraphNode extends Point {
  name: string
  label: string
}
export interface GraphEdge {
  from: Endpoint
  to: Endpoint
  label: string
  /** Only unambiguous, standalone edges can be reconnected without expanding DOT shorthand. */
  source?: { from: SourceRange; to: SourceRange }
}
export interface GraphState {
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
  directed: boolean
}

const layoutSchema = z.object({
  directed: z.boolean(),
  objects: z
    .array(
      z.object({
        _gvid: z.number(),
        name: z.string(),
        pos: z.string().optional(),
        label: z.string().optional(),
      })
    )
    .default([]),
  edges: z
    .array(
      z.object({
        _gvid: z.number(),
        tail: z.number(),
        head: z.number(),
        label: z.string().optional(),
      })
    )
    .default([]),
})
let runtime: ReturnType<typeof instance> | undefined
const graphviz = () =>
  (runtime ??= import('@viz-js/viz')
    .then((module) => module.instance())
    .catch((cause) => {
      runtime = undefined
      return Promise.reject(cause)
    }))

/** Layout fills missing positions; authored positions remain authoritative, in SVG coordinates. */
export async function executeDot(
  contents: string
): Promise<{ graph: GraphState; document: DotDocument } | Error> {
  const document = readDot(contents)
  if (isErr(document)) return document
  try {
    const viz = await graphviz()
    const positioned =
      document.ids.size > 0 &&
      [...document.ids.keys()].every((name) => document.positions.has(name))
    const engine = positioned ? 'nop2' : 'neato'
    const override = insertStatement(
      contents,
      document,
      `graph [layout="${engine}", inputscale=72, notranslate=true, overlap=true];`
    )
    // Only the layout copy is augmented; user source retains comments, styles, and subgraphs.
    const input = ChangeSet.of(
      [...positionChanges(contents, document, document.positions), override],
      contents.length
    )
      .apply(Text.of(contents.split('\n')))
      .toString()
    const layout = layoutSchema.parse(viz.renderJSON(input, { engine }))
    const anchor = layout.objects.find(
      (node) => node.pos && document.positions.has(node.name)
    )
    const origin = anchor
      ? document.positions.get(anchor.name)!
      : { x: 0, y: 0 }
    const [anchorX, anchorY] = anchor?.pos?.split(',').map(Number) ?? [0, 0]
    // neato recenters its inputs; align newly laid-out nodes with the authored frame.
    const offset = { x: origin.x - anchorX, y: origin.y + anchorY }
    const nodes: Record<string, GraphNode> = Object.fromEntries(
      layout.objects
        .filter((node) => node.pos)
        .map((node) => {
          const [x, y] = node.pos!.split(',').map(Number)
          const point = document.positions.get(node.name) ?? {
            x: x + offset.x,
            y: -y + offset.y,
          }
          return [
            `n${node._gvid}`,
            {
              ...point,
              name: node.name,
              label:
                node.label && node.label !== '\\N' ? node.label : node.name,
            },
          ]
        })
    )
    const pair = (from: string, to: string) =>
      JSON.stringify(layout.directed ? [from, to] : [from, to].sort())
    const edges: Record<string, GraphEdge> = Object.fromEntries(
      layout.edges.map((edge) => {
        const from = `n${edge.tail}`,
          to = `n${edge.head}`
        const candidates = document.edges.filter(
          (candidate) =>
            candidate.targets.length === 2 &&
            candidate.targets[0].type === 'NodeRef' &&
            candidate.targets[1].type === 'NodeRef' &&
            pair(
              candidate.targets[0].id.value,
              candidate.targets[1].id.value
            ) === pair(nodes[from].name, nodes[to].name)
        )
        const simple =
          candidates.length === 1 &&
          layout.edges.filter(
            (other) =>
              pair(
                nodes[`n${other.tail}`].name,
                nodes[`n${other.head}`].name
              ) === pair(nodes[from].name, nodes[to].name)
          ).length === 1
            ? candidates[0]
            : undefined
        const first = simple?.targets[0],
          last = simple?.targets[1]
        const source =
          first && last
            ? {
                from: {
                  from: first.location!.start.offset,
                  to: first.location!.end.offset,
                },
                to: {
                  from: last.location!.start.offset,
                  to: last.location!.end.offset,
                },
              }
            : undefined
        return [`e${edge._gvid}`, { from, to, label: edge.label ?? '', source }]
      })
    )
    return { graph: { nodes, edges, directed: layout.directed }, document }
  } catch (cause) {
    return isErr(cause) ? cause : new Error('Unable to lay out DOT', { cause })
  }
}

export const dotExecutorCapability = defineExecutorCapability({
  id: 'dot.graph',
  matches: (context) => /\.(dot|gv)$/i.test(context.src),
  execute: executeDot,
})
