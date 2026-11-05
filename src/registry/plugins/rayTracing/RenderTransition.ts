/** Fade into tracing; return to the real-time view immediately. */
export class RenderTransition {
  private duration = 800
  private from = 0
  private target = 0
  private started = 0
  value = 0
  active = false

  setDuration(duration: number, now: number) {
    if (!Number.isFinite(duration) || duration < 0) return
    this.advance(now)
    if (this.active) {
      const progress = Math.min(
        1,
        Math.max(0, (now - this.started) / this.duration)
      )
      this.started = now - progress * duration
    } else {
      this.from = this.target = this.value
    }
    this.duration = duration
    this.advance(now)
  }

  update(traced: boolean, now: number, animate: boolean) {
    const target = traced ? 1 : 0
    if (!animate || !traced) {
      this.from = this.target = this.value = target
      this.active = false
      return this.value
    }
    this.advance(now)
    if (target !== this.target) {
      this.from = this.value
      this.target = target
      this.started = now
    }
    return this.advance(now)
  }

  private advance(now: number) {
    const progress =
      this.duration === 0
        ? 1
        : Math.min(1, Math.max(0, (now - this.started) / this.duration))
    this.value = this.from + (this.target - this.from) * progress
    this.active = progress < 1 && this.from !== this.target
    return this.value
  }
}
