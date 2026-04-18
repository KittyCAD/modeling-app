import type { ExtensionNode } from '@src/lib/extensions'
import { telemetry } from '@src/extensions/telemetry'
import { settings } from '@src/extensions/settings'

export const coreExtensions: ExtensionNode[] = [telemetry, settings]
