export default function makePathRelative(path: string) {
  return path.replace(/^\//, '')
}
