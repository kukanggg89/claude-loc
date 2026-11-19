import type { EngineInterface as Engine } from 'claude-code'

import { dayOfMonth, monthOf, weekdayOf } from './dates'
import type { DayEntry, Report } from './report'
import { type Tally, sumTallies } from './tally'

type Elements = Pick<ReturnType<Engine['ui']['resolve']>, 'Box' | 'Text'>
type Chart = { title: string | null; days: DayEntry[] }

const BAR_MAX = 12
const NUMBER_WIDTH = 10
const DAY_WIDTH = 8
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const COLUMNS = ['Added', 'Removed', 'Diff']

const groupDigits = (n: number) => String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const signed = (n: number, sign: string) => (n ? `${sign}${groupDigits(n)}` : '0')
const net = (t: Tally) => t.added - t.removed
const formatNet = (n: number) => (n < 0 ? `−${groupDigits(n)}` : n > 0 ? `+${groupDigits(n)}` : '0')
const netColor = (n: number) => (n > 0 ? 'success' : n < 0 ? 'error' : undefined)

const shortLabel = (date: string) => `${MONTHS[monthOf(date)]} ${dayOfMonth(date)}`
const longLabel = (date: string) => `${WEEKDAYS[weekdayOf(date)]}, ${shortLabel(date)}`
const barLabel = (date: string) => `${WEEKDAYS[weekdayOf(date)]} ${dayOfMonth(date)}`

const barFor = (value: number, max: number) =>
  value > 0 && max > 0 ? '█'.repeat(Math.max(1, Math.round((value / max) * BAR_MAX))) : ''

const titleOf = ({ range, today }: Report) => {
  if (!range) return `Today · ${longLabel(today)}`
  if (range.from !== range.to) return `${shortLabel(range.from)} to ${shortLabel(range.to)}`
  return range.from === today ? `Today · ${longLabel(today)}` : longLabel(range.from)
}

const chartOf = ({ range, days }: Report): Chart | null => {
  const newestFirst = [...days].reverse()
  if (!range) return { title: `Last ${days.length} days`, days: newestFirst }
  return range.from === range.to ? null : { title: null, days: newestFirst }
}

const tallyLine = (t: Tally) => `${signed(t.added, '+')} / ${signed(t.removed, '−')} · diff ${formatNet(net(t))}`

export const plainText = (report: Report) => {
  const chart = chartOf(report)
  const lines = [
    `**${titleOf(report)}:** ${tallyLine(report.focus)}`,
    '',
    ...report.focus.projects.map(p => `- ${p.project}: ${signed(p.added, '+')} / ${signed(p.removed, '−')}`),
  ]
  if (!chart) return lines.join('\n')
  const chartTitle = chart.title ? [`**${chart.title}:** ${tallyLine(sumTallies(chart.days.map(d => d.summary)))}`, ''] : []
  return [...lines, '', ...chartTitle, ...chart.days.map(d => `- ${barLabel(d.date)}: ${formatNet(net(d.summary))}`)].join(
    '\n',
  )
}

export const renderReport = ({ Box, Text }: Elements, report: Report) => {
  const numberCell = (text: string, color?: string, dim?: boolean) => (
    <Box width={NUMBER_WIDTH} justifyContent="flex-end">
      <Text color={color} dimColor={dim} tabular>
        {text}
      </Text>
    </Box>
  )

  const tallyCells = (t: Tally) => [
    numberCell(signed(t.added, '+'), t.added ? 'success' : undefined, !t.added),
    numberCell(signed(t.removed, '−'), t.removed ? 'error' : undefined, !t.removed),
    numberCell(formatNet(net(t)), netColor(net(t)), !net(t)),
  ]

  const row = (label: JSX.Element, cells: JSX.Element[]) => (
    <Box flexDirection="row">
      <Box flexGrow={1} flexShrink={1}>
        {label}
      </Box>
      {cells}
    </Box>
  )

  const dayRow = ({ date, summary }: DayEntry, maxNet: number) =>
    row(
      <Box flexDirection="row">
        <Box width={DAY_WIDTH}>
          <Text dimColor={date !== report.today}>{barLabel(date)}</Text>
        </Box>
        <Text color="claude">{barFor(net(summary), maxNet)}</Text>
      </Box>,
      [numberCell(''), numberCell(''), numberCell(formatNet(net(summary)), netColor(net(summary)), !net(summary))],
    )

  const chartRows = (chart: Chart) => {
    const maxNet = Math.max(0, ...chart.days.map(d => net(d.summary)))
    return [
      <Text dimColor wrap="clip">
        {'─'.repeat(120)}
      </Text>,
      ...(chart.title ? [row(<Text bold>{chart.title}</Text>, tallyCells(sumTallies(chart.days.map(d => d.summary))))] : []),
      ...chart.days.map(day => dayRow(day, maxNet)),
    ]
  }

  const chart = chartOf(report)

  return (
    <Box flexDirection="column">
      {row(
        <Text bold>{titleOf(report)}</Text>,
        COLUMNS.map(column => numberCell(column, undefined, true)),
      )}
      {row(<Text bold>Total</Text>, tallyCells(report.focus))}
      {report.focus.projects.map(p => row(<Text>{p.project}</Text>, tallyCells(p)))}
      {chart && chartRows(chart)}
    </Box>
  )
}
