import type { Register } from 'claude-code'

import { parseQuery } from './query'
import { type Report, buildReport, currentDate, warmIndex } from './report'
import { plainText, renderReport } from './view'

const COMMAND = 'loc'
const INDEXING_WAIT_MS = 8_000
const STILL_INDEXING = 'Still reading your session history. Run /loc again in a moment.'

const reports = new Map<string, Report>()

const reportShownAs = (shownText: string) => {
  for (const [text, report] of reports) if (shownText.endsWith(text)) return report
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Lines of code Claude wrote today, on a date, or across a range',
      argumentHint: '[yesterday | 18 | nov 18 | wed | 10-18]',
      immediate: true,
    })
    void warmIndex($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const today = await currentDate($)
    const query = parseQuery(String(e.args ?? ''), today)
    if (query.kind === 'error') return { text: query.message, isTextDisplayOnly: true }
    const building = buildReport($, today, query.kind === 'range' ? query.range : null)
    const report = await Promise.race([building, $.clock.sleep(INDEXING_WAIT_MS).then(() => null)])
    if (!report) return { text: STILL_INDEXING, isTextDisplayOnly: true }
    const text = plainText(report)
    reports.set(text, report)
    return { text, isTextDisplayOnly: true }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, async ($, e, next) => {
    const report = reportShownAs(e.props.text)
    return report ? renderReport($.ui.resolve(e), report) : next(e)
  })
}
