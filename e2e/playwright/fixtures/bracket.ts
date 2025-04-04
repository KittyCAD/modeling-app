import fs from 'fs'
import path from 'path'

export const bracket = fs.readFileSync(
  path.resolve(
    __dirname,
    '../',
    '../',
    '../',
    'public',
    'kcl-samples',
    'bracket',
    'main.kcl'
  ),
  'utf8'
)
