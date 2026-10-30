import { EditorState } from '@codemirror/state'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { describe, expect, it } from 'vitest'
import {
  collectInlineFeatures,
  inlineFeaturesField,
  inlinePlanesField,
  revealInlineFeature,
  setInlineFeatures,
  setInlinePlanes,
} from './inlineFeatures'

function call(start: number, end: number, name = 'extrude'): Operation {
  return {
    type: 'StdLibCall',
    name,
    sourceRange: [start, end, 0],
    nodePath: { steps: [] },
    unlabeledArg: null,
    labeledArgs: {},
  }
}

describe('inline feature source projection', () => {
  it('interleaves features with comments and parameters in source order', () => {
    const code =
      '// plate\nheight = 12\nbody = extrude(profile, length = height)\n// finish\nedge = fillet(body, radius = 2)'
    const a = code.indexOf('body =')
    const b = code.indexOf('edge =')
    const features = collectInlineFeatures(
      code,
      [
        { start: a, end: code.indexOf('\n', a) },
        { start: b, end: code.length },
      ],
      [call(a + 7, code.indexOf('\n', a)), call(b + 7, code.length, 'fillet')],
      (n) => n
    )
    expect(features.map(({ from, to }) => code.slice(from, to))).toEqual([
      'body = extrude(profile, length = height)',
      'edge = fillet(body, radius = 2)',
    ])
    expect(code.slice(0, features[0].from)).toContain('height = 12')
    expect(code.slice(features[0].to, features[1].from)).toContain('// finish')
  })

  it('keeps pipeline features together and refuses to hide trailing comments', () => {
    const code = 'body = extrude(p) |> fillet(radius = 2)'
    const operations = [call(7, 17), call(21, code.length, 'fillet')]
    expect(
      collectInlineFeatures(
        code,
        [{ start: 0, end: code.length }],
        operations,
        (n) => n
      )[0].operations
    ).toHaveLength(2)
    expect(
      collectInlineFeatures(
        `${code} // keep me`,
        [{ start: 0, end: code.length }],
        operations,
        (n) => n
      )
    ).toEqual([])
  })

  it('converts UTF-8 offsets before slicing Unicode source', () => {
    const code = '// café 🦊\nbody = extrude(p)'
    const from = code.indexOf('body')
    const byteStart = new TextEncoder().encode(code.slice(0, from)).length
    const byteEnd = new TextEncoder().encode(code).length
    const offset = (n: number) =>
      new TextDecoder().decode(new TextEncoder().encode(code).slice(0, n))
        .length
    expect(
      collectInlineFeatures(
        code,
        [{ start: byteStart, end: byteEnd }],
        [call(byteStart + 7, byteEnd)],
        offset
      )[0]
    ).toMatchObject({ from, to: code.length })
  })

  it('shows a sketch once and leaves its internal operations inside its code', () => {
    const code = 'profile = sketch {\n  line()\n}'
    const sketch: Operation = {
      type: 'GroupBegin',
      group: { type: 'SketchBlock', sketchId: 1 },
      sourceRange: [0, code.length, 0],
      nodePath: { steps: [] },
    }
    const features = collectInlineFeatures(
      code,
      [{ start: 0, end: code.length }],
      [sketch, call(21, 27, 'line'), { type: 'GroupEnd' }],
      (n) => n
    )
    expect(features[0].operations).toEqual([sketch])
  })
})

describe('inline feature editor state', () => {
  it('keeps planes inside the editor ahead of line one through source edits', () => {
    const host = document.createElement('div')
    const initial = EditorState.create({
      doc: 'height = 12',
      extensions: [inlinePlanesField],
    })
    const installed = initial.update({
      effects: setInlinePlanes.of(host),
    }).state
    const edited = installed.update({
      changes: { from: 0, insert: '// note\n' },
    }).state
    const ranges = edited.field(inlinePlanesField)
    const first = ranges.iter()
    expect(ranges.size).toBe(1)
    expect(first.from).toBe(0)
    expect(edited.doc.toString()).toBe('// note\nheight = 12')
  })
  function state() {
    const initial = EditorState.create({
      doc: 'body = extrude(p)\nheight = 12',
      extensions: [inlineFeaturesField],
    })
    return initial.update({
      effects: setInlineFeatures.of([
        {
          id: 'body',
          from: 0,
          to: 17,
          operations: [],
          host: document.createElement('div'),
        },
      ]),
    }).state
  }
  it('reveals and collapses without changing source or history', () => {
    const before = state()
    const revealed = before.update({
      effects: revealInlineFeature.of({ id: 'body', expanded: true }),
    }).state
    expect(revealed.field(inlineFeaturesField).expanded.has('body')).toBe(true)
    const collapsed = revealed.update({
      effects: revealInlineFeature.of({ id: 'body', expanded: false }),
    }).state
    expect(collapsed.field(inlineFeaturesField).expanded.has('body')).toBe(
      false
    )
    expect(collapsed.doc.toString()).toBe(before.doc.toString())
  })
  it('invalidates every collapsed range immediately on edit', () => {
    const edited = state().update({
      changes: { from: 0, insert: '// change\n' },
    }).state
    expect(edited.field(inlineFeaturesField).decorations.size).toBe(0)
  })
  it('reveals code targeted by search or external selection', () => {
    const selected = state().update({ selection: { anchor: 8 } }).state
    expect(selected.field(inlineFeaturesField).expanded.has('body')).toBe(true)
  })
})
