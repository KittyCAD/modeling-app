import { ExtensionNode } from '@src/lib/extensions'
import { telemetry } from './telemetry'

export const coreExtensions: ExtensionNode[] = [telemetry].flat()
