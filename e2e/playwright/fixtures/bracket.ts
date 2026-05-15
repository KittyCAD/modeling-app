import fs from 'fs'
import path from 'path'

export const bracket = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'public',
    'kcl-samples-legacy',
    'bracket',
    'main.kcl'
  ),
  'utf8'
)
