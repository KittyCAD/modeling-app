import type { CommandProgressPlan } from '@rust/kcl-lib/bindings/CommandProgressPlan'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'

interface Stage {
  range: SourceRange
  weight: number
  positions: number[]
  sent: number
  completed: number
}

const key = (range: SourceRange) => range.join(':')

/** Match completed work to source milestones, rather than raw command ordinals. */
export class ExecutionProgress {
  private stages = new Map<string, Stage>()
  private requests = new Map<string, Stage[]>()
  private latestPositions = new Map<SourceRange[2], number>()
  private initialCount = 0

  reset() {
    this.stages.clear()
    this.requests.clear()
    this.latestPositions.clear()
    this.initialCount = 0
  }

  setPlan(plan: CommandProgressPlan) {
    this.reset()
    this.initialCount = plan.count
    for (const [index, milestone] of plan.milestones.entries()) {
      const id = key(milestone.sourceRange)
      const stage = this.stages.get(id) ?? {
        range: milestone.sourceRange,
        weight: 0,
        positions: [],
        sent: 0,
        completed: 0,
      }
      stage.weight++
      stage.positions.push(index)
      this.stages.set(id, stage)
    }
  }

  register(id: string, ranges: SourceRange[]) {
    const stages = ranges.map((range) => {
      let stage = this.stages.get(key(range))
      if (!stage) {
        // Helpers can report a more specific span than the mock's calling span.
        stage = [...this.stages.values()]
          .filter(
            (candidate) =>
              candidate.range[2] === range[2] &&
              candidate.range[0] <= range[0] &&
              candidate.range[1] >= range[1]
          )
          .sort(
            (a, b) => a.range[1] - a.range[0] - (b.range[1] - b.range[0])
          )[0]
      }
      if (!stage) {
        const following = [...this.stages.values()].find(
          (candidate) =>
            candidate.range[2] === range[2] && candidate.range[0] > range[0]
        )
        stage = {
          range,
          weight: Math.max(2, Math.ceil(this.initialCount * 0.05)),
          positions: [
            following
              ? following.positions[0] - 0.5
              : (this.latestPositions.get(range[2]) ?? -1) + 0.5,
          ],
          sent: 0,
          completed: 0,
        }
        this.stages.set(key(range), stage)
      }
      stage.sent++
      return stage
    })
    this.requests.set(id, stages)
  }

  complete(id: string) {
    for (const stage of this.requests.get(id) ?? []) {
      stage.completed++
      this.latestPositions.set(
        stage.range[2],
        Math.max(
          this.latestPositions.get(stage.range[2]) ?? -1,
          stage.positions[
            Math.min(stage.completed - 1, stage.positions.length - 1)
          ]
        )
      )
    }
    this.requests.delete(id)
  }

  get fraction(): number {
    let total = 0
    let completed = 0
    for (const stage of this.stages.values()) {
      total += stage.weight
      const closed =
        stage.sent > 0 &&
        stage.completed === stage.sent &&
        (this.latestPositions.get(stage.range[2]) ?? -1) >
          stage.positions[stage.positions.length - 1]
      // Keep room within the active source block for further loop iterations or
      // extra queries. Only a later milestone in the same module closes the block;
      // imported modules can execute concurrently.
      const expected = Math.max(
        stage.weight,
        stage.sent + Math.max(2, Math.ceil(stage.sent / 4))
      )
      completed += stage.weight * (closed ? 1 : stage.completed / expected)
    }
    return total ? Math.min(0.95, completed / total) : 0
  }

  get estimatedTotal(): number {
    const completed = [...this.stages.values()].reduce(
      (sum, stage) => sum + stage.completed,
      0
    )
    return this.fraction > 0
      ? Math.ceil(completed / this.fraction)
      : this.initialCount
  }
}
