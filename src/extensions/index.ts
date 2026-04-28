import type { ExtensionNode } from '@kittycad/extensions'
import { telemetry } from '@src/extensions/telemetry'
import { settings } from '@src/extensions/settings'

export const coreExtensions: ExtensionNode[] = [telemetry, settings]
