import type { ExtensionNode } from '@src/lib/extensions'
import { telemetry } from '@src/extensions/telemetry'

export const coreExtensions: ExtensionNode[] = [telemetry]
