import { expect, test } from 'claude-code/testing'

import { parseQuery } from '../hooks/query'

const TODAY = '2026-11-19'

const rangeOf = (args: string) => {
  const query = parseQuery(args, TODAY)
  return query.kind === 'range' ? query.range : query.kind
}

test('no argument asks for the overview', () => {
  expect(parseQuery('  ', TODAY)).toEqual({ kind: 'overview' })
})

test('single days resolve to the latest matching date', () => {
  expect(rangeOf('today')).toEqual({ from: '2026-11-19', to: '2026-11-19' })
  expect(rangeOf('Yesterday')).toEqual({ from: '2026-11-18', to: '2026-11-18' })
  expect(rangeOf('18')).toEqual({ from: '2026-11-18', to: '2026-11-18' })
  expect(rangeOf('25')).toEqual({ from: '2026-10-25', to: '2026-10-25' })
  expect(rangeOf('nov 10')).toEqual({ from: '2026-11-10', to: '2026-11-10' })
  expect(rangeOf('10 november')).toEqual({ from: '2026-11-10', to: '2026-11-10' })
  expect(rangeOf('thu')).toEqual({ from: '2026-11-19', to: '2026-11-19' })
  expect(rangeOf('wednesday')).toEqual({ from: '2026-11-18', to: '2026-11-18' })
})

test('a range resolves its end first, then the start before it', () => {
  expect(rangeOf('10-18')).toEqual({ from: '2026-11-10', to: '2026-11-18' })
  expect(rangeOf('oct 29 - nov 5')).toEqual({ from: '2026-10-29', to: '2026-11-05' })
  expect(rangeOf('mon-fri')).toEqual({ from: '2026-11-09', to: '2026-11-13' })
  expect(rangeOf('mon-today')).toEqual({ from: '2026-11-16', to: '2026-11-19' })
})

test('unreadable, reversed, and too old input is refused', () => {
  expect(rangeOf('foo')).toBe('error')
  expect(rangeOf('32')).toBe('error')
  expect(rangeOf('10-12-14')).toBe('error')
  expect(rangeOf('mo')).toBe('error')
  expect(rangeOf('today-yesterday')).toBe('error')
  expect(rangeOf('oct 1')).toBe('error')
  expect(rangeOf('20')).toBe('error')
})
