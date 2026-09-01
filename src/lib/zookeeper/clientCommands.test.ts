import { exportSave } from '@src/lib/exportSave'
import {
  CLIENT_COMMAND_SCHEMA_REVISION,
  CLIENT_COMMAND_SCHEMA_UPDATE,
  type ExecuteClientCommandDependencies,
  executeClientCommand,
  parseClientCommandRequest,
} from '@src/lib/zookeeper/clientCommands'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/exportSave', () => ({
  exportSave: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
  },
}))

describe('Zookeeper client commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('advertises only the explicit STEP export capability', () => {
    expect(CLIENT_COMMAND_SCHEMA_UPDATE).toEqual({
      type: 'update_client_command_schema',
      protocol_version: 1,
      revision: CLIENT_COMMAND_SCHEMA_REVISION,
      commands: [
        expect.objectContaining({
          id: 'modeling.export',
          input_schema: expect.objectContaining({
            required: ['format'],
            additionalProperties: false,
          }),
        }),
      ],
    })
  })

  it('parses the externally tagged server request', () => {
    expect(
      parseClientCommandRequest({
        client_command_request: {
          request_id: 'request-1',
          catalog_revision: 1,
          command_id: 'modeling.export',
          arguments: { format: 'step' },
        },
      })
    ).toEqual({
      request_id: 'request-1',
      catalog_revision: 1,
      command_id: 'modeling.export',
      arguments: { format: 'step' },
    })
    expect(parseClientCommandRequest({ delta: { delta: 'hello' } })).toBe(
      undefined
    )
  })

  it('exports through the active client Engine and waits for the save flow', async () => {
    const waitForProjectIdle = vi.fn().mockResolvedValue(undefined)
    const exportFromEngine = vi.fn().mockResolvedValue([
      {
        name: 'engine-output.step',
        contents: new Uint8Array([1, 2, 3]),
      },
    ])
    const kclManager = {
      ast: { body: [{}] },
      currentFileName: 'main.kcl',
      hasErrors: () => false,
      rustContext: { export: exportFromEngine },
    } as unknown as ExecuteClientCommandDependencies['kclManager']

    const result = await executeClientCommand(
      {
        request_id: 'request-1',
        catalog_revision: CLIENT_COMMAND_SCHEMA_REVISION,
        command_id: 'modeling.export',
        arguments: { format: 'step' },
      },
      { kclManager, defaultUnit: 'mm', waitForProjectIdle }
    )

    expect(waitForProjectIdle).toHaveBeenCalledOnce()
    expect(exportFromEngine).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'step', units: 'mm' }),
      { settings: { modeling: { base_unit: 'mm' } } },
      'toast-id'
    )
    expect(exportSave).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'main.step' })
    )
    expect(result).toEqual(
      expect.objectContaining({ status: 'succeeded', request_id: 'request-1' })
    )
  })
})
