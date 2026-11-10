/** Collect every SDK page before publishing a complete list. */
export async function collectApiPages<T>(pager: {
  hasNext(): boolean
  next(): Promise<T[]>
}): Promise<T[]> {
  const items: T[] = []
  while (pager.hasNext()) items.push(...(await pager.next()))
  return items
}
