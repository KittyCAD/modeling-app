import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandService, commandsValueSpec } from '@src/contracts/commands'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import {
  sceneInteractionsValueSpec,
  sceneItemsValueSpec,
} from '@src/contracts/scene'
import {
  EXIT_MODE_COMMAND,
  toolbarItemsValueSpec,
} from '@src/contracts/sceneModes'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import {
  SKETCHING_MODE,
  SKETCHING_SCOPE,
} from '@src/features/sceneToolbar/modes'
import { createBadgeReveal } from '@src/features/sketchOverlay/createBadgeReveal'
import { createSketchInteraction } from '@src/features/sketchOverlay/createSketchInteraction'
import { SketchScene } from '@src/features/sketchOverlay/SketchScene'
import { SketchAnnotations } from '@src/features/sketchOverlay/SketchAnnotations'
import { SketchProblem } from '@src/features/sketchOverlay/SketchProblem'
import { matchConstraint } from '@src/lib/sketch/constraints'
import {
  SKETCH_ACTIONS,
  type SketchActionKind,
  sketchToolbarItems,
} from '@src/features/sketchOverlay/catalog'

/**
 * Drawing in a sketch: what it looks like, and what the pointer does.
 *
 * Separate from `sketchMode`, which owns *where the user is* and the session's
 * lifecycle. This owns the two things that only make sense once a sketch is
 * open, and both of them are about the scene rather than about the file: an
 * overlay that draws the sketch, and an interaction that turns clicks into
 * points on its plane.
 *
 * Neither knows how the scene is rendered. The overlay asks the projection where
 * things are and the interaction asks it where a click landed; a renderer in
 * this process would answer the same questions differently and nothing here
 * would change.
 */
export default defineRegistryItemFactory((ctx) => {
  const sessions = () => ctx.services.optional(sketchSessionService)

  const interaction = createSketchInteraction({
    session: sessions,
    projection: () => ctx.services.optional(sceneProjectionService),
    graph: () =>
      ctx.services.optional(kclFrontendService)?.sceneGraph.value ?? null,
  })

  /**
   * Which segment's constraints are showing.
   *
   * Held here rather than in the component so it survives a re-render and can be
   * disposed with the feature: it owns timers, and a timer that outlives the
   * thing that set it fires into nothing.
   */
  const reveal = createBadgeReveal()

  /** True once there is a sketch open with a plane to draw on. */
  const drawable = computed(() => sessions()?.open.value?.plane != null)

  /**
   * What each kind of action does when it is pressed.
   *
   * The catalogue says what the buttons *are*; these three say what they do. Kept
   * apart because that is the honest shape of it — a modelling tool can be
   * derived whole from its stdlib signature, and a sketch action cannot: equipping
   * a tool starts a pointer state machine, a constraint is a matcher over the
   * selection, and a dimension measures geometry.
   */
  const runAction = (what: SketchActionKind) => {
    const session = sessions()
    if (!session) return

    switch (what.kind) {
      case 'tool':
        // A second press of the same tool puts it down, which is how somebody
        // stops drawing without reaching for anything.
        session.equip(session.tool.value === what.tool ? null : what.tool)
        return
      case 'constraint':
        session.applyConstraint(what.constraint)
        return
      case 'dimension':
        session.applyDimension()
        return
    }
  }

  /**
   * Whether it can be pressed, per kind.
   *
   * A constraint answers from the declarative model — "can this be applied to
   * what is selected" is a pure function — which is the point of that model: the
   * answer is available *before* the click rather than discovered by it.
   */
  const enabledFor = (what: SketchActionKind) =>
    computed(() => {
      const session = sessions()
      if (!session?.open.value) return false

      switch (what.kind) {
        case 'tool':
          return drawable.value
        case 'dimension':
          return session.selection.value.length === 2
        case 'constraint': {
          const graph =
            ctx.services.optional(kclFrontendService)?.sceneGraph.value
          if (!graph) return false

          return (
            matchConstraint(what.constraint, graph, session.selection.value)
              .status === 'complete'
          )
        }
      }
    })

  /** Only a tool can be *held*, so only a tool can look held. */
  const activeFor = (what: SketchActionKind) =>
    what.kind === 'tool'
      ? computed(() => sessions()?.tool.value === what.tool)
      : undefined

  /**
   * One command and one key per action, and the buttons derived from the list.
   *
   * Adding an action is a row in the catalogue plus its behaviour — the three
   * contributions it needs come from the row, and the toolbar is derived by the
   * same function the modelling toolbar uses.
   */
  const actionContributions = SKETCH_ACTIONS.flatMap((action) => {
    // Built once and reused: two computeds over the same question would be two
    // subscriptions and two answers.
    const active = activeFor(action.what)

    return [
      provide(commandsValueSpec, {
        id: action.commandId,
        title: action.title,
        category: 'Sketch',
        icon: action.icon,
        description: action.description,
        enabled: enabledFor(action.what),
        ...(active ? { active } : {}),
        run: () => runAction(action.what),
      }),

      ...(action.key
        ? [
            provide(keybindingsValueSpec, {
              keystrokes: [action.key],
              commandId: action.commandId,
              scopes: [SKETCHING_SCOPE],
            }),
          ]
        : []),
    ]
  })

  return {
    model: { pointer: interaction.pointer },
    item: defineRuntimeRegistryItem({
      id: 'sketchOverlay',
      dispose: () => reveal.dispose(),
      provides: [
        provide(sceneItemsValueSpec, {
          id: 'sketch.overlay',
          zone: 'fill',
          order: 0,
          // Mounted only while there is something to draw, so the projection is
          // not consulted — or subscribed to — the rest of the time.
          visible: drawable,
          render: () => <SketchScene pointer={interaction.pointer} />,
        }),

        /**
         * Constraints and dimensions, as DOM over the scene.
         *
         * A second item rather than part of the overlay, because it is a
         * different kind of thing: the overlay is a canvas that takes no pointer
         * events, and these are buttons and fields that must. In the same zone,
         * so they sit over the geometry they annotate.
         */
        provide(sceneItemsValueSpec, {
          id: 'sketch.annotations',
          zone: 'fill',
          order: 1,
          visible: drawable,
          render: () => (
            <SketchAnnotations pointer={interaction.pointer} reveal={reveal} />
          ),
        }),

        /**
         * Why a sketch would not open.
         *
         * At an edge rather than in the fill zone, because it has a button and
         * things in the fill zone take no pointer events — and outside the sketch
         * mode's toolbar, because failing to open a sketch is what *leaves* that
         * mode.
         */
        provide(sceneItemsValueSpec, {
          id: 'sketch.problem',
          zone: 'bottom',
          order: 0,
          visible: computed(
            () =>
              sessions()?.error.value != null ||
              sessions()?.open.value?.planeProblem != null
          ),
          render: () => <SketchProblem />,
        }),

        /**
         * Ahead of the camera, and claiming only while a tool is equipped.
         *
         * Order 50 puts it in front of the camera at 100 and selection at 200,
         * which is the only way to be: interactions share one element, so
         * `stopImmediatePropagation` from a listener bound earlier is what stops
         * them. With no tool equipped it claims nothing and orbiting works
         * exactly as it does outside a sketch.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'sketch.draw',
          order: 50,
          attach: interaction.attachTool,
        }),

        /**
         * Between the camera and selection, for clicks that are not drawing.
         *
         * The camera has to see a press or an orbit inside a sketch would stop
         * working; selection must not, because its answer to a click on nothing
         * is to leave the mode — which now finishes the sketch.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'sketch.pick',
          order: 150,
          attach: interaction.attachPick,
        }),

        ...actionContributions,
        ...sketchToolbarItems().map((item) =>
          provide(toolbarItemsValueSpec, item)
        ),

        /**
         * Escape, one step at a time.
         *
         * Backing out of a half-drawn line, putting the tool down, and finishing
         * the sketch are three different intentions, and a key that did all
         * three at once would be a key nobody could use mid-drawing. So Escape
         * undoes the innermost thing that is happening, and pressing it again
         * gets you further out — which is what it does in every CAD app.
         *
         * The last rung is the app-wide Escape. This binding is in the sketching
         * scope and therefore shadows it, so it has to be able to mean the same
         * thing when there is nothing sketch-specific left to stop.
         */
        provide(commandsValueSpec, {
          id: 'sketch.tool.cancel',
          title: 'Stop drawing',
          category: 'Sketch',
          icon: 'close',
          description:
            'Abandon the shape being drawn, then the tool, then the sketch.',
          run: () => {
            const session = sessions()
            const tool = session?.tool.value
            const drawing = session?.draft.value.kind !== 'idle'

            if (tool && drawing) {
              // Throws the draft segment away and stops the chain, leaving the
              // tool in hand.
              session?.cancelTool()
              return
            }
            if (tool) {
              session?.equip(null)
              return
            }
            if ((session?.selection.value.length ?? 0) > 0) {
              // After the tool, because a tool is the more active thing to be
              // holding — and before the mode, because leaving now writes the
              // sketch back and runs the program.
              session?.clearSelection()
              return
            }

            /*
             * Nothing sketch-specific left to stop, so this means what Escape
             * means everywhere: leave the mode. Which now writes the sketch
             * back, because the mode *is* the open sketch.
             */
            ctx.services.optional(commandService)?.run(EXIT_MODE_COMMAND)
          },
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Escape'],
          commandId: 'sketch.tool.cancel',
          scopes: [SKETCHING_SCOPE],
        }),

        /**
         * Delete what is selected.
         *
         * Two keys, because both are the delete key depending on the keyboard,
         * and a Mac keyboard's Backspace is where a PC's Delete is.
         */
        provide(commandsValueSpec, {
          id: 'sketch.delete',
          title: 'Delete selected',
          category: 'Sketch',
          icon: 'close',
          description: 'Remove the selected segments and constraints.',
          enabled: computed(
            () => (sessions()?.selection.value.length ?? 0) > 0
          ),
          run: () => sessions()?.deleteSelection(),
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Delete'],
          commandId: 'sketch.delete',
          scopes: [SKETCHING_SCOPE],
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Backspace'],
          commandId: 'sketch.delete',
          scopes: [SKETCHING_SCOPE],
        }),
      ],
    }),
  }
}, 'sketchOverlay')
