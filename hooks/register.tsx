import type { Register } from 'claude-code'

import { localDate } from './dates'
import { parseQuery } from './query'
import { type Report, buildReport, cachePastDays } from './report'
import { plainText, renderReport } from './view'

const COMMAND = 'loc'

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
    void cachePastDays($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const query = parseQuery(String(e.args ?? ''), localDate(await $.clock.now()))
    if (query.kind === 'error') return { text: query.message, isTextDisplayOnly: true }
    const report = await buildReport($, query.kind === 'range' ? query.range : null)
    const text = plainText(report)
    reports.set(text, report)
    return { text, isTextDisplayOnly: true }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, async ($, e, next) => {
    const report = reportShownAs(e.props.text)
    return report ? renderReport($.ui.resolve(e), report) : next(e)
  })
}
