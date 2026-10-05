import { constants as nodeConstants } from 'node:fs'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import { describe, expect, it } from 'vitest'

describe('fsZdsConstants', () => {
  it('matches Node filesystem access-mode bit flags', () => {
    expect({
      F_OK: fsZdsConstants.F_OK,
      X_OK: fsZdsConstants.X_OK,
      W_OK: fsZdsConstants.W_OK,
      R_OK: fsZdsConstants.R_OK,
    }).toEqual({
      F_OK: nodeConstants.F_OK,
      X_OK: nodeConstants.X_OK,
      W_OK: nodeConstants.W_OK,
      R_OK: nodeConstants.R_OK,
    })
  })
})
