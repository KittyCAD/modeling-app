import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  executePyorigami,
  executeAuthoring,
} from '@src/registry/plugins/pyorigami/render'

// Opt in with the environment created by scripts/setup-pyorigami.sh.
describe.skipIf(!process.env.ZDS_PYORIGAMI_PYTHON)(
  'pyOrigami Python rendering',
  () => {
    it('renders the sample and preserves all pages of a longer sequence', async () => {
      const contents = await readFile(
        'src/lib/pyorigami/example.origami.py',
        'utf8'
      )
      const sample = await executePyorigami(
        contents,
        'example.origami.py',
        new AbortController().signal
      )
      expect(sample.ok).toBe(true)
      if (!sample.ok) return
      expect(sample.pages).toHaveLength(1)
      expect(sample.pages[0]).toContain('<svg')
      expect(
        sample.authoring?.fields.filter(
          ({ target }) => target.kind === 'caption'
        )
      ).toHaveLength(2)
      for (const field of sample.authoring?.fields ?? []) {
        expect(field.x).toBeGreaterThanOrEqual(0)
        expect(field.y).toBeGreaterThanOrEqual(0)
        expect(field.x + field.width).toBeLessThanOrEqual(1.00001)
        expect(field.y + field.height).toBeLessThanOrEqual(1.00001)
      }
      const longer = await executePyorigami(
        `${contents}\ndiagram.body = diagram.body * 20`,
        'long.origami.py',
        new AbortController().signal
      )
      expect(longer.ok).toBe(true)
      if (longer.ok) {
        expect(longer.pages.length).toBeGreaterThan(1)
        expect(longer.pages.every((page) => page.includes('<svg'))).toBe(true)
      }
    }, 30_000)

    it('authors a caption through a module alias and renders its editable region', async () => {
      const source =
        'import pyorigami as ori\ndiagram = ori.Diagram(ori.DiagramHeader(), [ori.Step(body=[ori.Square("a", "b", "c", "d")])])\n'
      const changed = await executeAuthoring(
        source,
        { kind: 'caption', step: 0, caption: 0, value: 'Fold here' },
        new AbortController().signal
      )
      expect(changed.ok).toBe(true)
      if (!changed.ok) return
      expect(changed.contents).toContain("ori.Caption('Fold here')")
      const output = await executePyorigami(
        changed.contents,
        'authored.origami.py',
        new AbortController().signal
      )
      expect(output.ok).toBe(true)
      if (output.ok)
        expect(output.authoring?.fields).toContainEqual(
          expect.objectContaining({
            target: { kind: 'caption', step: 0, caption: 0 },
            value: 'Fold here',
            editable: true,
          })
        )
    }, 10_000)

    it('preserves editable caption ownership across multiple PDF pages', async () => {
      const contents =
        'from pyorigami import Diagram, DiagramHeader, Step, Square, Caption\ndiagram = Diagram(DiagramHeader(), [' +
        Array.from(
          { length: 24 },
          (_, index) =>
            `Step(body=[Square("a", "b", "c", "d"), Caption("Step ${index + 1}")])`
        ).join(',') +
        '])\n'
      const output = await executePyorigami(
        contents,
        'pages.origami.py',
        new AbortController().signal
      )
      expect(output.ok).toBe(true)
      if (!output.ok) return
      expect(output.pages.length).toBeGreaterThan(1)
      const captions =
        output.authoring?.fields.filter(
          ({ target }) => target.kind === 'caption'
        ) ?? []
      expect(captions).toHaveLength(24)
      expect(captions.at(-1)).toMatchObject({
        page: output.pages.length - 1,
        target: { kind: 'caption', step: 23, caption: 0 },
        value: 'Step 24',
      })
    }, 10_000)

    it('reports missing diagrams and Python tracebacks', async () => {
      const missing = await executePyorigami(
        'print("hello")',
        'missing.origami.py',
        new AbortController().signal
      )
      expect(missing).toEqual({
        ok: false,
        error: expect.stringContaining("variable named 'diagram'"),
      })
      const broken = await executePyorigami(
        'raise ValueError("bad crease")',
        'broken.origami.py',
        new AbortController().signal
      )
      expect(broken).toEqual({
        ok: false,
        error: expect.stringContaining('ValueError: bad crease'),
      })
    }, 10_000)

    it('terminates a running Python program when its snapshot is cancelled', async () => {
      const controller = new AbortController()
      const pending = executePyorigami(
        'while True: pass',
        'loop.origami.py',
        controller.signal
      )
      const timer = setTimeout(() => controller.abort(), 500)
      try {
        expect(await pending).toEqual({
          ok: false,
          error: 'pyOrigami operation was cancelled.',
        })
      } finally {
        clearTimeout(timer)
      }
    }, 5_000)
  }
)
