import { expect, test } from 'claude-code/testing'

import { streamLines } from '../hooks/transcripts'

const LINE_COUNT = 12_000

const lineAt = (index: number) => `${JSON.stringify({ index, pad: 'x'.repeat(900) })}\n`

const content = Array.from({ length: LINE_COUNT }, (_, index) => lineAt(index)).join('')

const readerOf = (text: string) => async (start: number, end: number) => text.slice(start, end)

const indexesIn = (lines: string) =>
  lines
    .split('\n')
    .filter(Boolean)
    .map(line => (JSON.parse(line) as { index: number }).index)

test('streaming stops before an unfinished last line and resumes from there', async () => {
  const written = `${content.slice(0, 5_000_000)}`
  const seen: number[] = []
  const offset = await streamLines(readerOf(written), written.length, 0, lines => seen.push(...indexesIn(lines)))

  expect(offset).toBe(written.lastIndexOf('\n') + 1)

  const end = await streamLines(readerOf(content), content.length, offset, lines => seen.push(...indexesIn(lines)))

  expect(end).toBe(content.length)
  expect(seen).toEqual(Array.from({ length: LINE_COUNT }, (_, index) => index))
})
