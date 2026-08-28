import type {
  ArgumentResolver,
  TextEdit,
} from '@src/contracts/modelingOperations'
import type { KclSceneService } from '@src/contracts/kclScene'
import type { SelectionService } from '@src/contracts/selection'
import { faceReference } from '@src/lib/kcl/faceReferences'
import { regionExpression } from '@src/lib/kcl/regionExpression'
import { boundNames, referenceAt } from '@src/lib/kclStdlib/program'
import { arityOf, namedTypesIn } from '@src/lib/kclStdlib/types'

/**
 * The types that mean "a face", as opposed to the thing that made one.
 *
 * `Plane` is here because sketching on a face and sketching on a plane are the
 * same argument, and a clicked face has to answer it as a face.
 */
const FACES = ['Face', 'TaggedFace', 'Plane']

/** KCL types a click on the model could plausibly answer. */
const GEOMETRIC = [
  'Sketch',
  'Solid',
  'Face',
  'Plane',
  'Segment',
  'Edge',
  'TaggedFace',
  'TaggedEdge',
]

/**
 * Answer an argument by clicking the model.
 *
 * The chain is the point, and every link already existed: the engine says which
 * *entity* was clicked, the artifact graph says which *source range* drew it, and
 * the program says which *binding* contains that range. The binding's name is
 * what a KCL call can refer to — so clicking a wall and extruding it produces
 * `extrude(profile001, …)` with no tagging, no uuids in the source, and nothing
 * for the operation to know about.
 *
 * Offered alongside the binding resolver rather than instead of it, so the same
 * argument can be answered by name or by pointing. Ordered first, because if
 * something is already selected that is almost certainly what the operation is
 * about.
 */
export function createSelectionResolver(
  selection: () => SelectionService | undefined,
  /** For turning a region's bordering curves into references. */
  scene: () => KclSceneService | undefined
): ArgumentResolver {
  return {
    id: 'modeling.resolver.selection',
    label: 'From the scene',
    order: -10,

    handles: (input) =>
      namedTypesIn(input.type).some((name) => GEOMETRIC.includes(name)),

    /*
     * Ready when something is already selected.
     *
     * Deliberately not "selected *and* of the right type": what a click can
     * answer is decided when the answer is turned into KCL, and a selection the
     * user made a moment ago is almost certainly what the operation is about. If
     * it turns out not to fit, the method list is right there.
     */
    ready: () => (selection()?.entities.value.length ?? 0) > 0,

    prompt: ({ input }) => {
      /*
       * How many entities the argument takes is a fact about its *type*.
       *
       * `[TaggedFace; 1+]` on `shell` wants several faces; `Solid` on `fillet`
       * wants one. Reading the arity means the prompt is told the truth without
       * anybody declaring it per operation, and an argument that grows a plural
       * type in kcl-lib grows a plural prompt with no change here.
       */
      const arity = arityOf(input.type)
      const multiple = arity !== null && (arity.max === null || arity.max > 1)

      return {
        kind: 'selection',
        accepts: namedTypesIn(input.type).filter((name) =>
          GEOMETRIC.includes(name)
        ),
        ...(multiple ? { multiple: true } : {}),
      }
    },

    /**
     * Entity ids in, KCL source out — and the edits that make it valid.
     *
     * Two cases, and the second is the V2 one.
     *
     * An entity the artifact graph can name is referred to directly: its source
     * range sits inside a binding, and that binding's name is the reference.
     *
     * A **region** has no artifact, because it does not exist until it is
     * written into the file. What the engine gave us is the two curves bordering
     * the area, which are segments that *do* exist — so the answer is a new
     * `region001 = region(segments = [triangle.line1, triangle.line2])` bound
     * above, and a reference to it. That binding is a prerequisite: it travels as
     * data and lands in the same transaction as the operation, so clicking never
     * wrote anything and cancelling leaves nothing behind.
     */
    toArgument: (answer, { input, program }) => {
      const service = selection()
      const graph = scene()
      const wanted = answer.split(/\s+/).filter(Boolean)

      const references: string[] = []
      const prerequisites: TextEdit[] = []
      const taken = new Set(boundNames(program.ast))

      /** A free name that also avoids the ones minted in this same answer. */
      const nameFor = (stem: string) => {
        for (let index = 1; index < 1000; index += 1) {
          const candidate = `${stem}${String(index).padStart(3, '0')}`
          if (!taken.has(candidate)) {
            taken.add(candidate)
            return candidate
          }
        }
        return `${stem}${Date.now()}`
      }

      /*
       * What *kind* of reference the argument wants.
       *
       * The same click means different things to different arguments. A wall
       * clicked for `region(segments = …)` is the segment that drew it; the same
       * wall clicked for `sketch(on = …)` is a face, and a face is written a
       * different way entirely. Asking the argument's declared type is what keeps
       * one click from having to guess.
       */
      const asFace = namedTypesIn(input.type).some((name) =>
        FACES.includes(name)
      )

      for (const entityId of wanted) {
        const entity = service?.entities.value.find(
          (candidate) => candidate.entityId === entityId
        )
        if (!entity) continue

        /*
         * A face is not the segment that made it.
         *
         * Naming a face is strange enough to live in one place, so this asks
         * rather than works it out: side faces go through their swept segment or
         * its region, caps go through a position, and imported faces cannot be
         * named at all. When the Face API lands, that module changes and this line
         * does not.
         */
        if (asFace) {
          const face = faceReference(entityId, {
            artifacts: graph?.artifacts.value ?? new Map(),
            program: program.ast,
          })
          if (face) {
            if (!references.includes(face.source)) references.push(face.source)
            continue
          }
        }

        // Already in the file under a name: refer to it.
        if (entity.sourceRange) {
          const reference = referenceAt(program.ast, entity.sourceRange[0])
          if (reference && !references.includes(reference)) {
            references.push(reference)
          }
          continue
        }

        // Not in the file: write it, then refer to that.
        if (!entity.region) continue

        /*
         * Deduplicated, which is not a tidy-up but the documented behaviour.
         *
         * "For a single closed segment such as a circle, pass only that
         * segment" — and a circle is exactly the case where the engine's walking
         * curve and its intersecting curve are the same one. Writing it twice
         * would be wrong KCL rather than merely noisy.
         */
        const segments: string[] = []
        for (const segmentId of entity.region.segmentIds) {
          const range = graph?.sourceRangeFor(segmentId)
          if (!range) continue

          const reference = referenceAt(program.ast, range[0])
          if (reference && !segments.includes(reference)) {
            segments.push(reference)
          }
        }

        const expression = regionExpression({
          segments,
          intersectionIndex: entity.region.intersectionIndex,
          intersectionCount: entity.region.intersectionCount,
          clockwise: entity.region.clockwise,
        })
        if (!expression) continue

        const name = nameFor('region')
        const source = program.source
        const separator =
          source.length === 0 || source.endsWith('\n') ? '' : '\n'

        prerequisites.push({
          from: source.length,
          to: source.length,
          insert: `${separator}${name} = ${expression}\n`,
        })
        references.push(name)
      }

      // Several selected things in one binding are one reference, and several
      // bindings are a list — which is what an argument with an arity wants.
      return {
        source:
          references.length > 1
            ? `[${references.join(', ')}]`
            : (references[0] ?? ''),
        prerequisites,
      }
    },
  }
}
