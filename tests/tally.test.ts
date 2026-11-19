import { expect, test } from 'claude-code/testing'

import { lastDates, localDate } from '../hooks/dates'
import { type TallyScope, fileEditTally, heredocLines, tallyTranscript } from '../hooks/tally'
import { completeLines, utf8Length } from '../hooks/transcripts'

const line = (entry: object) => JSON.stringify(entry)
const localNoon = (day: number) => new Date(2026, 10, day, 12).toISOString()
const scopeFor = (...dates: string[]): TallyScope => ({ wanted: new Set(dates), seen: new Map(), days: new Map() })
const result = (id: string, timestamp: string, toolUseResult: object, isError = false) =>
  line({
    type: 'user',
    timestamp,
    cwd: 'D:/p',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
    toolUseResult,
  })
const bashCall = (id: string, command: string) =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })

test('a day follows the local clock', () => {
  expect(localDate(new Date(2026, 10, 18, 23, 59).getTime())).toBe('2026-11-18')
  expect(localDate(new Date(2026, 10, 19, 0, 0).getTime())).toBe('2026-11-19')
  expect(lastDates('2026-11-01', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
})

test('a heredoc into a file counts its body, other heredocs do not', () => {
  expect(heredocLines("cat > a.py <<'EOF'\nprint(1)\nprint(2)\nEOF\npython a.py")).toBe(2)
  expect(heredocLines('git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"')).toBe(0)
  expect(heredocLines("python - <<'EOF'\nprint(1)\nEOF")).toBe(0)
})

test('an edit counts its patch, a new file its content, memory files nothing', () => {
  expect(fileEditTally({ structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] })).toEqual({ added: 2, removed: 1 })
  expect(fileEditTally({ type: 'create', content: 'a\nb\n', structuredPatch: [] })).toEqual({ added: 2, removed: 0 })
  expect(fileEditTally({ type: 'create', content: 'a', memdirStamped: true })).toBe(null)
})

test('a transcript counts successful results once, by local day and cwd', () => {
  const transcript = [
    bashCall('b1', 'cat > x <<EOF\n1\n2\n3\nEOF'),
    result('b1', localNoon(19), { stdout: '' }),
    result('e1', localNoon(19), { structuredPatch: [{ lines: ['+a', '-b'] }] }),
    result('e2', localNoon(19), { structuredPatch: [{ lines: ['+z'] }] }, true),
    result('e3', localNoon(18), { structuredPatch: [{ lines: ['+old'] }] }),
  ].join('\n')
  const scope = scopeFor('2026-11-19')
  tallyTranscript(transcript, scope)
  tallyTranscript(transcript, scope)
  expect(scope.days.get('2026-11-19')?.get('D:/p')).toEqual({ added: 4, removed: 1 })
  expect(scope.days.has('2026-11-18')).toBe(false)
})

test('reading a transcript in two parts counts the same as reading it whole', () => {
  const first = bashCall('b1', 'cat > x <<EOF\n1\n2\nEOF')
  const second = [
    result('b1', localNoon(19), { stdout: '' }),
    result('e1', localNoon(19), { structuredPatch: [{ lines: ['+a'] }] }),
  ].join('\n')
  const whole = scopeFor('2026-11-19')
  tallyTranscript(`${first}\n${second}`, whole)

  const parts = scopeFor('2026-11-19')
  const heredocs = new Map<string, number>()
  tallyTranscript(first, parts, heredocs)
  tallyTranscript(second, parts, heredocs)

  expect(parts.days).toEqual(whole.days)
  expect(heredocs.size).toBe(0)
})

test('an unfinished last line waits for the next read, measured in bytes', () => {
  expect(completeLines('{"a":1}\n{"b":"é')).toEqual({ lines: '{"a":1}\n', pendingBytes: 8 })
  expect(completeLines('{"a":1}\n')).toEqual({ lines: '{"a":1}\n', pendingBytes: 0 })
  expect(utf8Length('aé€😀')).toBe(1 + 2 + 3 + 4)
})
