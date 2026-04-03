import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'

export type Point2D = [x: number, y: number]

export type ToolUiEvent = { type: 'point'; point: Point2D } | { type: 'escape' }

export type CircleToolYield =
  | { type: 'await-center-point' }
  | { type: 'await-radius-point'; center: Point2D }
  | { type: 'commit-circle'; center: Point2D; radiusPoint: Point2D }

export type ToolCompletion = {
  reason: 'unequipped'
}

export type SketchToolInput =
  | { type: 'scene-click'; point: Point2D; clickCount?: number }
  | { type: 'scene-move'; point: Point2D }
  | { type: 'escape' }

export type SketchToolStatus = 'active' | 'unequipped'

export type SketchToolSnapshot = {
  instructionType: string | null
}

export interface SketchTool {
  readonly name: string
  equip(): Promise<void>
  advance(input: SketchToolInput): Promise<SketchToolStatus>
  cancel(): Promise<SketchToolStatus>
  unequip(): Promise<void>
  isEquipped(): boolean
  getSnapshot(): SketchToolSnapshot
}

export type CircleCommitResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}

export type SketchOutcomeMeta = {
  writeToDisk?: boolean
}

export type DraftEntities = {
  segmentIds: Array<number>
  constraintIds: Array<number>
}

export type StartLineDraftResult = CircleCommitResult & {
  draftPointId: number
  newlyAddedEntities?: DraftEntities
}

export type CommitLineDraftResult = CircleCommitResult & {
  lastPointId?: number
}

export type GeneratorToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  commitCircle?: (input: {
    centerPoint: Point2D
    startPoint: Point2D
  }) => Promise<CircleCommitResult>
  startLineDraft?: (input: {
    startPoint: Point2D
  }) => Promise<StartLineDraftResult>
  previewLineDraft?: (input: {
    draftPointId: number
    point: Point2D
  }) => Promise<CircleCommitResult | void> | CircleCommitResult | void
  commitLineDraft?: (input: {
    draftPointId: number
    point: Point2D
    isDoubleClick?: boolean
  }) => Promise<CommitLineDraftResult>
  startChainedLineDraft?: (input: {
    lastPointId: number
    draftPoint: Point2D
  }) => Promise<StartLineDraftResult>
  onSketchOutcome?: (
    outcome: CircleCommitResult,
    meta?: SketchOutcomeMeta
  ) => void
  onRadiusPreview?: (center: Point2D, radiusPoint: Point2D) => void
  clearRadiusPreview?: () => void
  setDraftEntities?: (entities: DraftEntities) => void
  clearDraftEntities?: () => void
  deleteDraftEntities?: () => void
}

type ToolFactory = (context: GeneratorToolContext) => SketchTool

type SceneClickArgs = {
  mouseEvent?: { which?: number; detail?: number }
  intersectionPoint?: { twoD?: { x: number; y: number } }
}

type SceneMoveArgs = {
  intersectionPoint?: { twoD?: { x: number; y: number } }
}

type SceneCallbacks = {
  onClick: (args?: SceneClickArgs) => void
  onMove: (args?: SceneMoveArgs) => void
}

const NOOP_CALLBACKS: SceneCallbacks = {
  onClick: () => {},
  onMove: () => {},
}

const UNEQUIP_TOOL = Symbol('unequip-tool')
const CANCEL_CURRENT_CIRCLE = Symbol('cancel-current-circle')

function* waitForCenterPoint(): Generator<
  CircleToolYield,
  Point2D | typeof UNEQUIP_TOOL,
  ToolUiEvent
> {
  const event = yield { type: 'await-center-point' }
  return event.type === 'escape' ? UNEQUIP_TOOL : event.point
}

function* waitForRadiusPoint(
  center: Point2D
): Generator<
  CircleToolYield,
  Point2D | typeof CANCEL_CURRENT_CIRCLE,
  ToolUiEvent
> {
  const event = yield { type: 'await-radius-point', center }
  return event.type === 'escape' ? CANCEL_CURRENT_CIRCLE : event.point
}

type LineToolResumeEvent =
  | { type: 'point'; point: Point2D; clickCount?: number }
  | { type: 'move'; point: Point2D }
  | { type: 'escape' }

type LineToolYield =
  | { type: 'await-line-start' }
  | { type: 'start-first-draft-line'; startPoint: Point2D }
  | { type: 'preview-draft-line'; draftPointId: number }
  | {
      type: 'commit-draft-line'
      draftPointId: number
      point: Point2D
      isDoubleClick?: boolean
    }
  | { type: 'await-next-draft-line-start'; lastPointId: number }
  | {
      type: 'start-chained-draft-line'
      lastPointId: number
      draftPoint: Point2D
    }
  | { type: 'delete-current-draft' }

const STOP_LINE_CHAIN = Symbol('stop-line-chain')
const DELETE_CURRENT_LINE_DRAFT = Symbol('delete-current-line-draft')

function* waitForLineStart(): Generator<
  LineToolYield,
  Point2D | typeof UNEQUIP_TOOL,
  LineToolResumeEvent
> {
  while (true) {
    const event = yield { type: 'await-line-start' }
    if (event.type === 'escape') {
      return UNEQUIP_TOOL
    }
    if (event.type === 'point') {
      return event.point
    }
  }
}

function* previewDraftLine(
  draftPointId: number
): Generator<
  LineToolYield,
  | { point: Point2D; isDoubleClick?: boolean }
  | typeof DELETE_CURRENT_LINE_DRAFT,
  LineToolResumeEvent
> {
  while (true) {
    const event = yield { type: 'preview-draft-line', draftPointId }
    if (event.type === 'escape') {
      return DELETE_CURRENT_LINE_DRAFT
    }
    if (event.type === 'point') {
      return {
        point: event.point,
        isDoubleClick: event.clickCount === 2,
      }
    }
  }
}

function* waitForNextDraftLineStart(
  lastPointId: number
): Generator<
  LineToolYield,
  Point2D | typeof STOP_LINE_CHAIN,
  LineToolResumeEvent
> {
  while (true) {
    const event = yield { type: 'await-next-draft-line-start', lastPointId }
    if (event.type === 'escape') {
      return STOP_LINE_CHAIN
    }
    if (event.type === 'move') {
      return event.point
    }
    if (event.type === 'point' && event.clickCount === 2) {
      return STOP_LINE_CHAIN
    }
  }
}

abstract class GeneratorSketchTool<
  TInstruction extends { type: string },
  TResumeEvent extends { type: string },
  TCompletion,
> implements SketchTool
{
  private iterator?: Generator<TInstruction, TCompletion, TResumeEvent>
  private pendingResume: Promise<SketchToolStatus> =
    Promise.resolve('unequipped')
  protected instruction: TInstruction | null = null

  abstract readonly name: string

  constructor(protected readonly context: GeneratorToolContext) {}

  async equip() {
    const iterator = this.createGenerator()
    this.iterator = iterator

    const firstStep = iterator.next()
    if (firstStep.done) {
      await this.onComplete(firstStep.value)
      this.finish()
      return
    }

    this.instruction = firstStep.value
    await this.applyInstruction(firstStep.value)
  }

  abstract advance(input: SketchToolInput): Promise<SketchToolStatus>

  async cancel(): Promise<SketchToolStatus> {
    return this.advance({ type: 'escape' })
  }

  async unequip() {
    this.finish()
  }

  isEquipped(): boolean {
    return this.iterator !== undefined
  }

  getSnapshot(): SketchToolSnapshot {
    return {
      instructionType: this.instruction?.type ?? null,
    }
  }

  protected abstract createGenerator(): Generator<
    TInstruction,
    TCompletion,
    TResumeEvent
  >

  protected abstract applyInstruction(instruction: TInstruction): Promise<void>

  protected dispatchResume(event: TResumeEvent): Promise<SketchToolStatus> {
    return this.enqueueResume(() => this.resumeGenerator(event))
  }

  protected continueGenerator(): Promise<SketchToolStatus> {
    return this.resumeGenerator()
  }

  protected setSceneCallbacks(callbacks: SceneCallbacks) {
    this.context.sceneInfra.setCallbacks(callbacks as any)
  }

  protected clearSceneCallbacks() {
    this.setSceneCallbacks(NOOP_CALLBACKS)
  }

  protected onTeardown() {}

  protected async onComplete(_completion: TCompletion) {}

  private enqueueResume(
    operation: () => Promise<SketchToolStatus>
  ): Promise<SketchToolStatus> {
    const nextResume = this.pendingResume.then(operation, operation)
    nextResume.catch(() => {})
    this.pendingResume = nextResume
    return nextResume
  }

  private async resumeGenerator(
    event?: TResumeEvent
  ): Promise<SketchToolStatus> {
    if (!this.iterator) {
      return 'unequipped'
    }

    const step =
      event === undefined ? this.iterator.next() : this.iterator.next(event)

    if (step.done) {
      await this.onComplete(step.value)
      this.finish()
      return 'unequipped'
    }

    this.instruction = step.value
    await this.applyInstruction(step.value)
    return 'active'
  }

  private finish() {
    this.onTeardown()
    this.iterator = undefined
    this.instruction = null
    this.clearSceneCallbacks()
  }
}

export class CircleTool extends GeneratorSketchTool<
  CircleToolYield,
  ToolUiEvent,
  ToolCompletion
> {
  readonly name = 'circleTool'

  async advance(input: SketchToolInput): Promise<SketchToolStatus> {
    switch (input.type) {
      case 'scene-click':
        return this.dispatchResume({ type: 'point', point: input.point })
      case 'scene-move':
        if (this.instruction?.type === 'await-radius-point') {
          this.context.onRadiusPreview?.(this.instruction.center, input.point)
        }
        return this.isEquipped() ? 'active' : 'unequipped'
      case 'escape':
        return this.dispatchResume({ type: 'escape' })
    }
  }

  protected createGenerator(): Generator<
    CircleToolYield,
    ToolCompletion,
    ToolUiEvent
  > {
    return this.flow()
  }

  protected async applyInstruction(instruction: CircleToolYield) {
    switch (instruction.type) {
      case 'await-center-point':
        this.context.clearRadiusPreview?.()
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({ type: 'scene-click', point })
          },
          onMove: () => {},
        })
        return

      case 'await-radius-point':
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({ type: 'scene-click', point })
          },
          onMove: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({ type: 'scene-move', point })
          },
        })
        return

      case 'commit-circle': {
        this.context.clearRadiusPreview?.()
        const commitCircle = this.context.commitCircle
        if (!commitCircle) {
          throw new Error(
            'CircleTool requires a commitCircle implementation for commit-circle yields'
          )
        }
        const outcome = await commitCircle({
          centerPoint: instruction.center,
          startPoint: instruction.radiusPoint,
        })
        this.context.onSketchOutcome?.(outcome)
        await this.continueGenerator()
        return
      }
    }
  }

  protected override onTeardown() {
    this.context.clearRadiusPreview?.()
  }

  private *flow(): Generator<CircleToolYield, ToolCompletion, ToolUiEvent> {
    while (true) {
      const center = yield* waitForCenterPoint()
      if (center === UNEQUIP_TOOL) {
        return { reason: 'unequipped' }
      }

      const radiusPoint = yield* waitForRadiusPoint(center)
      if (radiusPoint === CANCEL_CURRENT_CIRCLE) {
        continue
      }

      yield {
        type: 'commit-circle',
        center,
        radiusPoint,
      }
    }
  }
}

export class LineTool extends GeneratorSketchTool<
  LineToolYield,
  LineToolResumeEvent,
  ToolCompletion
> {
  readonly name = 'lineTool'
  private nextDraftPointId?: number
  private nextLastPointId?: number

  async advance(input: SketchToolInput): Promise<SketchToolStatus> {
    switch (input.type) {
      case 'scene-click':
        return this.dispatchResume({
          type: 'point',
          point: input.point,
          clickCount: input.clickCount,
        })
      case 'scene-move':
        if (this.instruction?.type === 'preview-draft-line') {
          const previewResult = await this.context.previewLineDraft?.({
            draftPointId: this.instruction.draftPointId,
            point: input.point,
          })
          if (previewResult) {
            this.context.onSketchOutcome?.(previewResult, {
              writeToDisk: false,
            })
          }
          return this.isEquipped() ? 'active' : 'unequipped'
        }
        if (this.instruction?.type === 'await-next-draft-line-start') {
          return this.dispatchResume({ type: 'move', point: input.point })
        }
        return this.isEquipped() ? 'active' : 'unequipped'
      case 'escape':
        return this.dispatchResume({ type: 'escape' })
    }
  }

  protected createGenerator(): Generator<
    LineToolYield,
    ToolCompletion,
    LineToolResumeEvent
  > {
    return this.flow()
  }

  protected async applyInstruction(instruction: LineToolYield) {
    switch (instruction.type) {
      case 'await-line-start':
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({
              type: 'scene-click',
              point,
              clickCount: args?.mouseEvent?.detail,
            })
          },
          onMove: () => {},
        })
        return

      case 'start-first-draft-line': {
        const startLineDraft = this.context.startLineDraft
        if (!startLineDraft) {
          throw new Error('LineTool requires startLineDraft')
        }
        const result = await startLineDraft({
          startPoint: instruction.startPoint,
        })
        this.context.onSketchOutcome?.(result)
        if (result.newlyAddedEntities) {
          this.context.setDraftEntities?.(result.newlyAddedEntities)
        }
        this.nextDraftPointId = result.draftPointId
        await this.continueGenerator()
        return
      }

      case 'preview-draft-line':
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({
              type: 'scene-click',
              point,
              clickCount: args?.mouseEvent?.detail,
            })
          },
          onMove: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({
              type: 'scene-move',
              point,
            })
          },
        })
        return

      case 'commit-draft-line': {
        const commitLineDraft = this.context.commitLineDraft
        if (!commitLineDraft) {
          throw new Error('LineTool requires commitLineDraft')
        }
        const result = await commitLineDraft({
          draftPointId: instruction.draftPointId,
          point: instruction.point,
          isDoubleClick: instruction.isDoubleClick,
        })
        this.context.onSketchOutcome?.(result, { writeToDisk: true })
        this.context.clearDraftEntities?.()
        this.nextLastPointId = result.lastPointId
        await this.continueGenerator()
        return
      }

      case 'await-next-draft-line-start':
        this.setSceneCallbacks({
          onClick: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({
              type: 'scene-click',
              point,
              clickCount: args?.mouseEvent?.detail,
            })
          },
          onMove: (args) => {
            const point = readPoint(args)
            if (!point) {
              return
            }
            void this.advance({
              type: 'scene-move',
              point,
            })
          },
        })
        return

      case 'start-chained-draft-line': {
        const startChainedLineDraft = this.context.startChainedLineDraft
        if (!startChainedLineDraft) {
          throw new Error('LineTool requires startChainedLineDraft')
        }
        const result = await startChainedLineDraft({
          lastPointId: instruction.lastPointId,
          draftPoint: instruction.draftPoint,
        })
        this.context.onSketchOutcome?.(result)
        if (result.newlyAddedEntities) {
          this.context.setDraftEntities?.(result.newlyAddedEntities)
        }
        this.nextDraftPointId = result.draftPointId
        await this.continueGenerator()
        return
      }

      case 'delete-current-draft':
        this.context.deleteDraftEntities?.()
        this.context.clearDraftEntities?.()
        await this.continueGenerator()
        return
    }
  }

  protected override onTeardown() {
    this.context.clearDraftEntities?.()
  }

  override async unequip() {
    if (this.instruction?.type === 'preview-draft-line') {
      this.context.deleteDraftEntities?.()
    }
    this.context.clearDraftEntities?.()
    await super.unequip()
  }

  private *flow(): Generator<
    LineToolYield,
    ToolCompletion,
    LineToolResumeEvent
  > {
    while (true) {
      const startPoint = yield* waitForLineStart()
      if (startPoint === UNEQUIP_TOOL) {
        return { reason: 'unequipped' }
      }

      yield {
        type: 'start-first-draft-line',
        startPoint,
      }

      while (true) {
        const draftPointId = this.consumeNextDraftPointId()

        const draftOutcome = yield* previewDraftLine(draftPointId)
        if (draftOutcome === DELETE_CURRENT_LINE_DRAFT) {
          yield { type: 'delete-current-draft' }
          break
        }

        yield {
          type: 'commit-draft-line',
          draftPointId,
          point: draftOutcome.point,
          isDoubleClick: draftOutcome.isDoubleClick,
        }

        const lastPointId = this.consumeNextLastPointId()
        if (lastPointId === undefined) {
          break
        }

        const nextDraftStart = yield* waitForNextDraftLineStart(lastPointId)
        if (nextDraftStart === STOP_LINE_CHAIN) {
          break
        }

        yield {
          type: 'start-chained-draft-line',
          lastPointId,
          draftPoint: nextDraftStart,
        }
      }
    }
  }

  private consumeNextDraftPointId() {
    if (this.nextDraftPointId === undefined) {
      throw new Error('LineTool expected nextDraftPointId')
    }
    const draftPointId = this.nextDraftPointId
    this.nextDraftPointId = undefined
    return draftPointId
  }

  private consumeNextLastPointId() {
    const lastPointId = this.nextLastPointId
    this.nextLastPointId = undefined
    return lastPointId
  }
}

export class MockSketchMode {
  private readonly tools = new Map<string, ToolFactory>()
  private activeTool?: SketchTool

  constructor(private readonly context: GeneratorToolContext) {}

  registerTool(name: string, factory: ToolFactory) {
    this.tools.set(name, factory)
  }

  getSnapshot() {
    return {
      equippedToolName: this.activeTool?.name ?? null,
      instructionType: this.activeTool?.getSnapshot().instructionType ?? null,
    }
  }

  async equipTool(name: string) {
    const factory = this.tools.get(name)
    if (!factory) {
      throw new Error(`Unknown tool: ${name}`)
    }

    await this.unequipTool()

    const tool = factory(this.context)
    await tool.equip()
    this.activeTool = tool.isEquipped() ? tool : undefined
  }

  async unequipTool() {
    if (!this.activeTool) {
      return
    }

    await this.activeTool.unequip()
    this.activeTool = undefined
  }

  async pressEscape() {
    if (!this.activeTool) {
      return
    }

    const status = await this.activeTool.cancel()
    if (status === 'unequipped') {
      this.activeTool = undefined
    }
  }

  async simulateSceneClick(point: Point2D, options?: { clickCount?: number }) {
    if (!this.activeTool) {
      return
    }

    const status = await this.activeTool.advance({
      type: 'scene-click',
      point,
      clickCount: options?.clickCount,
    })
    if (status === 'unequipped') {
      this.activeTool = undefined
    }
  }

  async simulateSceneMove(point: Point2D) {
    const status = await this.activeTool?.advance({
      type: 'scene-move',
      point,
    })
    if (status === 'unequipped') {
      this.activeTool = undefined
    }
  }
}

function readPoint(args?: SceneClickArgs | SceneMoveArgs): Point2D | null {
  const twoD = args?.intersectionPoint?.twoD
  if (!twoD) {
    return null
  }

  return [twoD.x, twoD.y]
}
