# Gantt for Super Productivity

A [Super Productivity](https://super-productivity.com) plugin (v20+) that shows projects and their tasks
as a Gantt chart. Each task gets a **planned** bar (start date to deadline) and an **actual** bar
(first to last day a subtask was checked off), so you can compare plan and progress at a glance.
It works from completion dates only; time tracking is not needed.

The UI follows the app language (English and Korean included; other languages fall back to English).

## Install

1. Get the ZIP: `release/gantt-chart-1.0.0.zip` (or build it with `npm run build`; only Node and
   the system `zip` command are needed).
2. In the app, open **Settings → Plugins → Install Plugin** (Choose Plugin File) and pick the ZIP.
3. Confirm the install warning. Uploading a ZIP with the same id (`gantt-chart`) replaces the plugin.

Open the chart from:

- the **Gantt** entry in the side menu,
- the Gantt button in the header (`view_timeline` icon),
- the "Open Gantt chart" shortcut (assign keys in Settings → Keyboard Shortcuts).

## Features

- **Rows**: one row per project with its tasks below. Click a project row to collapse or expand it;
  "Collapse all / Expand all" in the toolbar. Project rows show the combined plan/actual span and progress.
- **Timeline**: day / week / month zoom, a red line for today, and a "Today" button to scroll to it.
- **Filters**: project, hide done tasks, hide tasks without dates. Zoom, filters and collapsed groups are remembered.
- **Planned bar** (outlined)
  - Start = `dueWithTime` or `dueDay` (the app's planned date), end = `deadlineWithTime` or `deadlineDay` (the deadline).
  - With only one of the two, the bar is one day long and the missing end is drawn dashed. With neither, no bar.
- **Actual bar** (green)
  - Start = earliest subtask `doneOn`, end = latest subtask `doneOn` (including the task's own `doneOn` once it is done).
  - Tasks without subtasks show a single dot on the day they were done.
- **Progress**: share of subtasks done (e.g. `12/35 (34%)`) as the fill of the planned bar, a label next to
  the bars and a small bar next to the task name. The tick inside the planned bar marks how much of the
  planned time has passed.
- **Late tasks**
  - Past the deadline and not done: red outline, a dashed red run from the deadline to today, "Nd late" badge.
  - Done after the deadline: red outline and a red actual bar, "Nd late" badge.
  - In progress but at least 15 percentage points behind the elapsed time: orange outline, "Behind" badge.
- **Tooltip**: hover a bar or task name for planned span, actual span (and number of days with checks),
  progress and status.
- **Open task**: click a task name to open its detail panel in the app.
- **Live updates**: redraws when tasks or projects change (`dataChanged`), moves the today line when the day
  changes (`dayChange`) and switches language with the app (`languageChange`).
- Archived tasks are included (marked "Archived").
- Follows the app theme (light/dark, project colors).

## Limitations

- **Planned bars need dates.** Only tasks with a planned date and/or a deadline get one. Subtask dates are not used.
- **`doneOn` keeps only the last check.** Unchecking and re-checking a subtask replaces the old date, and
  unchecking removes it from the actual bar. Checking many subtasks at once records them all on that day.
- The actual bar starts at the first subtask check, which stands in for "when work started".
- Two levels only (task › subtask), as in the app. Tasks without a project are grouped under "(No project)".
- The day boundary follows the app's "start of next day" setting when the app provides it.
- The header button and shortcut labels are set when the plugin loads; after changing the app language
  they update on the next app start (the chart itself switches immediately).

## Development

```
src/
  manifest.json   id: gantt-chart
  plugin.js       header button and shortcut
  index.html      chart UI (iframe)
  lib.js          data model, inlined into index.html at build time
  i18n/*.json     UI strings; also inlined into index.html
  icon.svg
scripts/build.mjs builds dist/ and release/<id>-<version>.zip
test/             node --test unit tests for lib.js
```

```bash
npm test
```

```bash
npm run build
```

To add a language, add `src/i18n/<code>.json` with every key from `en.json` and list the code under
`i18n.languages` in `src/manifest.json`. Codes must match the app's language codes (lowercase, e.g. `pt-br`).

## License

MIT
