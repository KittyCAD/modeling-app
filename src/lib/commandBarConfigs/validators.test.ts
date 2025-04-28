import { parseEngineErrorMessage } from '@src/lib/commandBarConfigs/validators'

describe('parseEngineErrorMessage', () => {
  it('takes an engine error string and parses its json message', () => {
    const engineError =
      '[{"success": false,"request_id": "e6c0104b-ec60-4779-8e98-722f0a5019ec","errors": [{"error_code": "internal_engine","message": "Trajectory curve must be G1 continuous (with continuous tangents)"}]}]'
    const parsedEngineError = JSON.parse(engineError)
    const message = parseEngineErrorMessage(parsedEngineError)
    expect(message).toEqual(
      'Trajectory curve must be G1 continuous (with continuous tangents)'
    )
  })
})
