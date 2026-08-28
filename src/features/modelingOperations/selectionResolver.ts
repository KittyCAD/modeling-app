import type {
  ArgumentResolver,
  TextEdit,
} from '@src/contracts/modelingOperations'
import type { KclSceneService } from '@src/contracts/kclScene'
import type { SelectionService } from '@src/contracts/selection'
import { regionExpression } from '@src/lib/kcl/regionExpression'
import { boundNames, referenceAt } from '@src/lib/kclStdlib/program'
import { namedTypesIn } from '@src/lib/kclStdlib/types'

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

    prompt: ({ input }) => ({
      kind: 'selection',
      accepts: namedTypesIn(input.type).filter((name) =>
        GEOMETRIC.includes(name)
      ),
    }),

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
    toArgument: (answer, { program }) => {
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

      for (const entityId of wanted) {
        const entity = service?.entities.value.find(
          (candidate) => candidate.entityId === entityId
        )
        if (!entity) continue

        // Already in the file: refer to it.
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
