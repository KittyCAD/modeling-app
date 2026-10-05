import { defineContract, defineService } from '@kittycad/registry'

/** A single prompt handoff; object identity distinguishes repeated text. */
export interface ZookeeperPromptSeed {
  prompt: string
}

export interface ZookeeperPromptService {
  /** Retain a prompt only for the current project, even while its pane loads. */
  seedPrompt(projectPath: string, prompt: string): boolean
}

export const zookeeperPromptContract = defineContract({
  zookeeperPromptService: defineService<ZookeeperPromptService>(
    'zookeeper-prompt.service'
  ),
})

export const { zookeeperPromptService } = zookeeperPromptContract
