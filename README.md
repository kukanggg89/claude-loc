# claude-loc

A Claude Code mod that adds `/loc`: how many lines Claude wrote and removed today, on a past date, or across a range, split by project.

```
Today · Thu, Nov 19            Added    Removed       Diff
Total                         +2,804       −617     +2,187
my-webapp                     +1,391        −57     +1,334
claude-loc                      +300       −102       +198
──────────────────────────────────────────────────────────
Last 7 days                  +39,889     −4,039    +35,850
Thu 19  ██                                          +2,187
Wed 18  ███                                         +3,825
Tue 17  █                                           +1,234
```

Added lines show in green and removed lines in red.

## Usage

| Command | Shows |
| --- | --- |
| `/loc` | Today by project, plus the last 7 days |
| `/loc yesterday` | Yesterday |
| `/loc 18` | The most recent 18th |
| `/loc nov 18` or `/loc 18 nov` | November 18 |
| `/loc wed` | The most recent Wednesday, today included |
| `/loc 10-18` | The 10th through the 18th |
| `/loc oct 29-nov 5` | A range across two months |
| `/loc mon-fri` | The most recent Monday through Friday |

Dates go back up to 30 days. Days follow your computer's time zone.

The first session after installing reads the last 30 days of history in the background. If you run `/loc` before it finishes, you'll be asked to try again in a moment. After that, each run reads only what was added since the last one.

## What counts

- Lines added and removed by the Write and Edit tools, measured as a diff. A changed line counts as one added and one removed.
- Files written with a shell heredoc, such as `cat > file <<EOF`.
- Only edits that went through. Rejected or failed edits are skipped.

What doesn't count:

- Files changed with `sed`, scripts, or other shell commands.
- Code you typed yourself.
- Sessions on other machines or in the cloud. The mod reads only this computer's history.
- Claude's own memory files.

Projects are grouped by the git repository each session ran in. Sessions outside a repository use their folder name.

### Compared with the Team analytics dashboard

The "Lines accepted" figure on the Claude for Teams dashboard counts added plus removed lines from Edit and Write, groups days by UTC, and includes every device on your account. `/loc` shows added and removed separately, includes heredocs, uses your local time zone, and covers one machine, so the two numbers won't match exactly.

## Install

1. Clone the repository:

   ```sh
   git clone https://github.com/<owner>/claude-loc.git
   ```

2. Add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, using an absolute path:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-loc"
     }
   }
   ```

   To load several folders, separate them with `;` on Windows and `:` on macOS and Linux.

3. Start a new Claude Code session and run `/loc`.

To try it for one session without changing settings, run `claude --plugin-dir /path/to/claude-loc`.

## Privacy

The mod reads the session transcripts Claude Code already stores in `~/.claude/projects` (or under `CLAUDE_CONFIG_DIR`) and keeps a small index of daily totals in the mod's own store. It makes no network requests.

## Development

```sh
claude plugin validate .
claude plugin test .
```

The code lives in `hooks/`:

- `tally.ts` parses transcript lines into added and removed counts.
- `transcripts.ts` lists and reads transcript files.
- `report.ts` keeps a 30-day index of daily totals and reads only the bytes each transcript gained since the last run.
- `query.ts` parses the date argument.
- `view.tsx` draws the table and the plain-text fallback.
- `register.tsx` wires the `/loc` command.

## License

MIT
