import type { ArgumentResolver } from '@src/contracts/modelingOperations'
import type { SelectionService } from '@src/contracts/selection'
import { bindingContaining } from '@src/lib/kclStdlib/program'
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
  selection: () => SelectionService | undefined
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
     * Entity ids in, KCL source out.
     *
     * An entity whose range is inside no top-level binding contributes nothing:
     * it cannot be referred to yet. Naming it would be a prerequisite edit, which
     * is the machinery this resolver was shaped around and the next thing it
     * will need.
     */
    toArgument: (answer, { program }) => {
      const service = selection()
      const wanted = answer.split(/\s+/).filter(Boolean)

      const names: string[] = []
      for (const entityId of wanted) {
        const entity = service?.entities.value.find(
          (candidate) => candidate.entityId === entityId
        )
        const range = entity?.sourceRange
        if (!range) continue

        const binding = bindingContaining(program.ast, range[0])
        if (binding && !names.includes(binding.name)) names.push(binding.name)
      }

      // Several selected things in one binding are one reference, and several
      // bindings are a list — which is what an argument with an arity wants.
      return {
        source: names.length > 1 ? `[${names.join(', ')}]` : (names[0] ?? ''),
      }
    },
  }
}
