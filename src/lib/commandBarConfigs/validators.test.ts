import { parseEngineErrorMessage } from '@src/lib/commandBarConfigs/validators'

describe('parseEngineErrorMessage', () => {
  it('takes an engine error string and parses its json message', () => {
    const engineError =
      'engine error: [{"error_code":"internal_engine","message":"Trajectory curve must be G1 continuous (with continuous tangents)"}]'
    const message = parseEngineErrorMessage(engineError)
    expect(message).toEqual(
      'Trajectory curve must be G1 continuous (with continuous tangents)'
    )
  })

  it('retuns undefined on strings with different formats', () => {
    const s1 = 'engine error: []'
    const s2 = 'blabla'
    expect(parseEngineErrorMessage(s1)).toBeUndefined()
    expect(parseEngineErrorMessage(s2)).toBeUndefined()
  })
})
