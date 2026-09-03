export interface StepToKclDraft {
  attachment: File
  prompt: string
}

type StepToKclDraftListener = (draft: StepToKclDraft) => void

export function isStepFileName(fileName: string): boolean {
  return /\.(step|stp)$/i.test(fileName)
}

export function generatedKclFileName(stepFileName: string): string {
  const baseName = stepFileName.replace(/\.(step|stp)$/i, '') || 'model'
  return `${baseName}.generated.kcl`
}

export function buildStepToKclPrompt(stepFileName: string): string {
  const sourceName = stepFileName.replaceAll('`', "'")
  const outputName = generatedKclFileName(sourceName)

  return `Reconstruct the attached STEP model \`${sourceName}\` as standalone, editable KCL.

Activate the step-to-kcl skill before inspecting the source. Follow its evidence-ledger, source-frame, topology, workflow-budget, and final-verification rules. Treat the complete ISO-10303-21 data as dimensional and topological evidence: recover its units, coordinate system, solid bodies, overall dimensions, holes, pockets, repeated features, fillets, and chamfers as accurately as KCL supports.

Create a new file named \`${outputName}\`. Do not modify or delete existing project files, and do not import or reference the STEP file from the generated KCL. Prefer concise, idiomatic, parameterized KCL built from native sketches, sweeps, booleans, patterns, and edge treatments. Execute and render the result, fix any KCL errors, and clearly describe any approximations or unsupported source features when you finish.`
}

/**
 * A tiny handoff between the project menu and the lazily-mounted Zookeeper
 * pane. Keeping one pending draft means the file picker still works when the
 * pane is closed and mounts only after the menu action expands it.
 */
export class StepToKclDraftBroker {
  private pendingDraft: StepToKclDraft | undefined
  private listeners = new Set<StepToKclDraftListener>()

  request(attachment: File) {
    const draft = {
      attachment,
      prompt: buildStepToKclPrompt(attachment.name),
    }

    if (this.listeners.size === 0) {
      this.pendingDraft = draft
      return
    }

    this.pendingDraft = undefined
    this.listeners.forEach((listener) => listener(draft))
  }

  subscribe(listener: StepToKclDraftListener): () => void {
    this.listeners.add(listener)

    if (this.pendingDraft) {
      const draft = this.pendingDraft
      this.pendingDraft = undefined
      listener(draft)
    }

    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const stepToKclDraftBroker = new StepToKclDraftBroker()
