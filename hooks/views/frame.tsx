import type { PluginState, RenderChildren, RenderInput } from 'claude-code'

import type { Detail, IssueDetail, Label, LabelFilter, Milestone, MilestoneFilter, ParentChoices, Where } from '../../types'
import type { Draw, Look, Requests } from '../draw'
import { fit } from '../draw'
import { filterKey, isAll, labelWords, leftOut, NO_LABEL, sameFilter, stepLabel, withMode } from '../filter'
import { readable, wrap } from '../issue'
import type { Known } from '../load'
import { measure } from '../measure'
import type { Tracker } from '../tracker'
import * as step from '../where'

// What every view of a pane shares: what it is given to draw with, and the
// frame around its rows (the top row, the menu, the milestone filter's
// list, a detail's scrolling, the bottom line).

// A detail as last drawn in each pane, by pane id: how many rows it has,
// how many show, and the row each Button starts on. A pane showing a list
// has none: the engine's window stays where it is.
export const views = new Map<string, { rows: number; room: number; at: Map<string, number> }>()

// The Buttons each pane draws hidden, for the hotkeys of its menu while it
// is shut (DRAWING.md, The menu), and the first control drawn after them.
export const hidden = new Map<string, { keys: Set<string>; first: string }>()

// The issue detail's labels list or milestone list as last drawn in each
// pane, by pane id: which, and how many of its lines show, for the focus to
// scroll it (DRAWING-issue.md, The labels list); `first`, the lines above
// the first one a focus names. A pane without either open has none.
export const listShown = new Map<string, { list: 'labels' | 'milestones' | 'parents'; lines: number; room: number; first: number }>()

// What a press does, for the views: each changes what the panes show, so
// none of it is done while drawing.
export type Acts = {
  refresh: () => unknown
  showHelp: () => unknown
  leaveHelp: () => unknown
  setFilter: (filter: MilestoneFilter, label: string) => unknown
  setLabelFilter: (change: (f: LabelFilter) => LabelFilter, label: string) => unknown
  openIssue: (pane: string, n: number) => unknown
  followIssue: (n: number) => unknown
  goBack: () => unknown
  foldIssue: (n: number) => unknown
  foldMilestone: (title: string) => unknown
  openMilestone: (title: string | null) => unknown
  closeMilestone: (m: Milestone, closed: boolean) => Promise<unknown>
  assignMe: (i: IssueDetail, on: boolean) => Promise<boolean>
  writeIssue: (n: number, change: (t: Tracker) => Promise<string | null>, what: string) => Promise<boolean>
  toggleLabels: () => unknown
  setLabel: (i: IssueDetail, l: Label, on: boolean) => Promise<boolean>
  toggleMilestones: () => unknown
  setMilestone: (i: IssueDetail, m: Milestone | null, children: number[]) => Promise<boolean>
  toggleChildrenToo: () => unknown
  toggleParents: (i: IssueDetail, children: number[]) => unknown
  setParent: (i: IssueDetail, p: number | null, on: boolean, parents: number[]) => Promise<boolean>
  workOn: (i: IssueDetail) => unknown
  openUrl: (url: string) => unknown
  counted: <T>(label: string, action: () => Promise<T>) => Promise<T>
  chooseIcons: (value: 'icons' | 'text') => unknown
  chooseCompact: (value: 'on' | 'off') => unknown
  // The pane moved by one of where.ts's steps.
  go: (change: (w: Where) => Where) => Promise<unknown>
  // The milestone filter's list opened or shut.
  setFilterOpen: (change: (open: boolean) => boolean) => Promise<unknown>
  // In the milestone detail: Issues folded, Description unfolded, or the
  // closed milestones shown in the list.
  foldIssues: () => unknown
  setDescription: (change: (open: boolean) => boolean) => unknown
  toggleClosed: () => unknown
}

// The session's state, as types/index.d.ts has it.
type State = PluginState['whats-next']

// What the views draw from the session's state, read once per render by
// hooks/register.tsx: the views take no engine. `detail` and
// `parentChoices` are this pane's; `milestoneShown` the milestone the
// Milestones pane has open, null when it shows its list.
export type Shown = Pick<
  State,
  | 'repo'
  | 'version'
  | 'token'
  | 'setup'
  | 'overview'
  | 'spinner'
  | 'issues'
  | 'panesOpen'
  | 'filterOpen'
  | 'repoLabels'
  | 'childrenToo'
  | 'unfolded'
  | 'treeKids'
  | 'issuesFolded'
  | 'descriptionUnfolded'
  | 'milestones'
  | 'milestonesUnfolded'
  | 'milestoneIssues'
  | 'closedMilestones'
  | 'closedShown'
  | 'milestoneError'
> & { detail: Detail; parentChoices: ParentChoices; milestoneShown: string | null }

// What a view is given: the pane it draws and where that pane is, the look
// and the drawing made from it, what is known of the repo, the session's
// state it draws, the tracker behind it, and what a press does. `version` and `repository` are
// What's Next's own, for the bottom line; `requests` the Debug line's.
export type Pane = {
  e: RenderInput<'Pane'>
  id: string
  place: Where
  height: number
  look: Look
  draw: Draw
  known: Known | null
  shown: Shown
  tracker: Tracker | null
  acts: Acts
  version: string | null
  repository: string | null
  requests: Requests | null
  // The repo's name, owner/name, for what a list says of it.
  repoName: string
}

// What a pane can do, in its menu (DRAWING.md, The menu): each its words,
// its hotkey and what pressing it does. Pressing one shuts the menu.
export type Action = { key: string; label: string; hotkey: string; onPress: () => unknown }

// What the trees know: the children loaded of any issue (undefined while
// not asked yet), and the repo's open epics.
export function treeKnown(p: Pane) {
  const loadedKids = p.shown.treeKids
  const kidsOf = (n: number) => (n in loadedKids ? loadedKids[n] : undefined)
  const openEpics = p.known?.openEpics ?? new Set<number>()
  return { kidsOf, openEpics }
}

export type Frame = Awaited<ReturnType<typeof frame>>

// The frame of pane `p`, read once per render.
export async function frame(p: Pane) {
  const { id, look, draw: d, acts } = p
  const { Box, Text, Button } = look.ui
  const { columns } = look
  const height = p.height
  const bottomRule = d.bottomLine(p.version, p.repository ? () => acts.openUrl(p.repository ?? '') : undefined)
  const counter = d.requestsLine(p.requests)
  // The milestone filter both panes share, and what it is set to.
  const shownFilter = look.filter
  const setOption = shownFilter?.options.find(o => sameFilter(o.filter, shownFilter.set))
  const refreshAction: Action = { key: 'refresh', label: 'Refresh', hotkey: 'r', onPress: acts.refresh }
  // Help, the last line of every menu but the help page's own.
  const helpAction: Action = { key: 'help', label: 'Help', hotkey: 'h', onPress: acts.showHelp }
  const menuShown = p.place.menu
  const run = (a: Action) => async () => {
    await acts.go(step.shutMenu)
    await a.onPress()
  }
  // [ ☰ ] at the right of a top row; it shuts the milestone filter's list,
  // as that shuts the menu: one list under the top row at a time. With the
  // labels list or the milestone list open it shuts that list alone.
  const menuButton = (
    <Button
      key="menu"
      label="☰"
      onPress={async () => {
        await acts.setFilterOpen(() => false)
        await acts.go(w => (w.labels ? step.toggleLabels(w) : w.milestones ? step.toggleMilestones(w) : w.parents ? step.toggleParents(w) : step.toggleMenu(w)))
      }}
    />
  )
  // A list opened under the top row at its right, the menu's, the
  // milestone filter's or the labels list: drawn over the rows beneath,
  // which stay where they are, in a dim frame. `width` is its lines', each
  // padded to it so it covers what is under it. The last child of the pane,
  // so it is painted last. `scroll`: a list that may run past the pane is
  // cut to it, moved up by that many lines, as a detail's rows are. `head`:
  // a line above them that stays when they scroll. `top`: the pane row its
  // frame starts on, under the top row unless it says otherwise.
  const overlay = (key: string, width: number, lines: RenderChildren[], scroll?: number, head: RenderChildren = null, top = 1) => {
    const room = overlayRoom(top) - (head ? 1 : 0)
    const cut = scroll !== undefined && lines.length > room
    return (
      <Box
        key={key}
        position="absolute"
        top={top}
        left={Math.max(0, columns - width - 2)}
        width={Math.min(columns, width + 2)}
        flexDirection="column"
        borderStyle="single"
        borderDimColor
      >
        {head}
        {cut ? (
          <Box key={`${key}-room`} height={room} flexShrink={0} flexDirection="column" overflow="hidden">
            <Box key={`${key}-lines`} marginTop={-Math.min(scroll, lines.length - room)} height={lines.length} flexShrink={0} flexDirection="column">
              {lines}
            </Box>
          </Box>
        ) : (
          lines
        )}
      </Box>
    )
  }
  // How many lines a list cut by `overlay` shows, its head line included,
  // its frame starting on pane row `top`.
  function overlayRoom(top = 1) {
    return Math.max(2, height - top - 2 - (counter ? 1 : 0))
  }
  // The pane row a detail's control `key` is drawn on, below top row `top`
  // and scrolled as `detailFrame` scrolls it; null when it is not drawn.
  const rowOf = (top: RenderChildren, body: RenderChildren[], key: string): number | null => {
    const shown = measure(body)
    const at = shown.at.get(key)
    if (at === undefined) return null
    const above = measure(top).rows + 1
    const room = Math.max(1, height - above - 2 - (counter ? 1 : 0))
    const offset = Math.min(Math.max(0, shown.rows - room), p.place.scroll)
    return above + at - offset
  }
  // The menu open: each action's words and, dim at the right, its hotkey;
  // `note`, dim under them, says what it lacks.
  const MENU = 17
  const menuLines = (actions: readonly Action[], note?: string, top = 1) =>
    menuShown &&
    overlay('menu-lines', MENU, [
      ...actions.map(a => (
        <Box key={`menu-line-${a.key}`} height={1} flexShrink={0}>
          <Button key={`menu-${a.key}`} plain onPress={run(a)}>
            <Text>
              {fit(a.label, MENU - 2).padEnd(MENU - 1)}
              <Text dimColor>{a.hotkey}</Text>
            </Text>
          </Button>
        </Box>
      )),
      ...(note
        ? wrap(note, MENU).map((t, k) => (
            <Box key={`menu-note-${k}`} height={1} flexShrink={0}>
              <Text dimColor>{t}</Text>
              {t.length < MENU && <Text>{' '.repeat(MENU - t.length)}</Text>}
            </Box>
          ))
        : []),
    ], undefined, null, top)
  // Every action's hotkey, the menu shut or open: Buttons drawn hidden, at
  // the start of the top row, before `first`, the first control drawn.
  const hotkeys = (actions: readonly Action[], first: string) => {
    hidden.set(id, { keys: new Set(actions.map(a => a.key)), first })
    return (
      <Box key="hotkeys" display="none">
        {actions.map(a => (
          <Button key={a.key} label={a.label} hotkey={a.hotkey} onPress={run(a)} />
        ))}
      </Box>
    )
  }
  // With another What's Next pane open the engine draws tabs that name both, so a
  // title row leaves its pane's name out.
  const tabbed = p.shown.panesOpen.some(other => other !== id)
  // The label filter both list panes share, and the colour of each label
  // the repo has, once its labels were read.
  const labelsSet = look.labels
  const known = p.shown.repoLabels
  const colorOf = (name: string) => (known.kind === 'ok' ? (known.labels.find(l => l.name === name)?.color ?? '') : '')
  // The label filter's button says what it is set to, as the milestone
  // filter's does (#99, decided 5): All, No label, or the labels set, each
  // in its colour, joined by `and` or `or`, dim, No label first when it
  // ticks along, then each label left out after a dim `not` (#99, decided
  // 7); cut with … at `room` columns.
  const labelsButton = (room: number) => {
    const words = labelWords(labelsSet)
    const parts: RenderChildren[] = []
    if ('word' in words) parts.push(words.word)
    else {
      let left = Math.max(1, room)
      // Each name with the dim words before it.
      const set = words.none ? [NO_LABEL, ...words.labels] : words.labels
      const names = [
        ...set.map((name, k) => ({ name, before: k > 0 ? words.join : '', plain: words.none && k === 0 })),
        ...words.not.map((name, k) => ({ name, before: set.length + k > 0 ? ', not ' : 'not ', plain: false })),
      ]
      names.forEach(({ name: l, before, plain }, k) => {
        if (left <= 0) return
        if (before) {
          const join = fit(before, left)
          parts.push(<Text key={`labels-join-${k}`} dimColor>{join}</Text>)
          left -= join.length
          if (left <= 0 || join.endsWith('…')) return void (left = 0)
        }
        const text = fit(l, left)
        const color = plain ? undefined : readable(colorOf(l))
        parts.push(
          <Text key={`labels-set-${k}`} color={color} dimColor={!plain && !color}>
            {text}
          </Text>,
        )
        left -= text.length
        if (text.endsWith('…')) left = 0
      })
    }
    return (
      <Button key="labels" hotkey="l" onPress={acts.toggleLabels}>
        {parts}
        {' ▾'}
      </Button>
    )
  }
  // The title row both lists share: the pane's name when no tab names it,
  // the label filter and the milestone filter, the menu (docs/TERMINOLOGY.md,
  // label filter). Milestones, which shows every milestone, has neither filter.
  const titleRow = (name: string, withFilter = true) => {
    const shown = withFilter ? setOption : undefined
    // What the labels button may take: the row, less the name, the milestone
    // filter's button, the menu's and the gaps, and its own `[ `, ` ▾ ]`.
    const room = shown ? columns - (tabbed ? 0 : name.length + 2) - (shown.label.length + 6) - 2 - 5 - 2 - 6 : 0
    return (
      <Box key="top" flexDirection="column" flexShrink={0}>
        <Box key="title" height={1} flexShrink={0}>
          {hotkeys([refreshAction, helpAction], shown ? 'labels' : 'menu')}
          {!tabbed && (
            <Text bold wrap="truncate-end">
              {name}
            </Text>
          )}
          <Box flexGrow={1} />
          {shown && labelsButton(room)}
          {shown && <Box width={2} />}
          {shown && (
            <Button
              key="milestone"
              label={`${shown.label} ▾`}
              hotkey="m"
              onPress={async () => {
                await acts.go(w => step.shutLabels(step.shutMenu(w)))
                await acts.setFilterOpen(o => !o)
              }}
            />
          )}
          <Box width={2} />
          {menuButton}
        </Box>
      </Box>
    )
  }
  // The label filter's list, open over a list's rows under the top row
  // (docs/TERMINOLOGY.md, label filter): `Labels` and its ✕, then `and · or`,
  // the one set bold, then ▸ All, then No label: under and ▸ No label, an
  // action as All, under or a box that ticks along with the labels (#99,
  // decided 6c); then the repo's labels, each after a box that says
  // whether the filter is set to it; a press sets it or takes it out, and
  // the list stays open for the next. Cut to the pane and scrolled by its
  // focus, as the issue detail's labels list.
  // A list's line that is an action, not a choice among the rest: a dim ▸
  // before its words, bold while the filter is set to it (#99, decided 6c).
  const actionText = (words: string, set: boolean, width: number) => (
    <Text>
      <Text dimColor>{'▸ '}</Text>
      <Text bold={set}>{fit(words, width - 2).padEnd(width - 2)}</Text>
    </Text>
  )
  const labelFilterList = (top: number) => {
    const said = (key: string, text: string, props: Record<string, unknown>) => (
      <Box key={key} height={1} flexShrink={0}>
        <Text {...props}>{text}</Text>
      </Box>
    )
    // A label set that the repo's list does not hold (renamed, taken off,
    // or the list not read) keeps its box, so it can be taken out.
    const listed = known.kind === 'ok' ? known.labels : []
    const labels: Label[] = [
      ...listed,
      ...[...labelsSet.labels, ...leftOut(labelsSet)].filter(n => !listed.some(l => l.name === n)).map(name => ({ name, color: '' })),
    ]
    const width = Math.min(columns - 2, Math.max(10, ...labels.map(l => l.name.length + 2)))
    const head = (
      <Box key="labels-shut-head" height={1} flexShrink={0}>
        <Text dimColor>{fit('Labels', width - 2).padEnd(width - 1)}</Text>
        <Button key="labels-shut" plain onPress={acts.toggleLabels}>
          <Text>✕</Text>
        </Button>
      </Box>
    )
    if (labels.length === 0) {
      const text =
        known.kind === 'ok' ? `No labels in ${p.repoName}.` : known.kind === 'error' ? `Could not load the labels: ${known.message}.` : 'Loading …'
      const w = Math.min(columns - 2, Math.max(10, text.length))
      return overlay('labels-list', w, [said('labels-said', fit(text, w).padEnd(w), known.kind === 'error' ? { color: 'error' } : { dimColor: true })], undefined, head, top)
    }
    const mode = (m: LabelFilter['mode']) => (
      <Button key={`label-${m}`} plain onPress={() => acts.setLabelFilter(f => withMode(f, m), m)}>
        <Text bold={labelsSet.mode === m} dimColor={labelsSet.mode !== m}>
          {m}
        </Text>
      </Button>
    )
    const lines = [
      <Box key="label-modes" height={1} flexShrink={0}>
        {mode('and')}
        <Text dimColor>{' · '}</Text>
        {mode('or')}
        <Text>{' '.repeat(Math.max(0, width - 8))}</Text>
      </Box>,
      // ▸ All sets it on every issue at once.
      <Box key="label-all-line" height={1} flexShrink={0}>
        <Button key="label-all" plain onPress={() => acts.setLabelFilter(f => ({ ...f, labels: [], none: false, not: [] }), 'All')}>
          {actionText('All', isAll(labelsSet), width)}
        </Button>
      </Box>,
      // No label: under and, an action that sets it on the issues without a
      // label alone; under or, a box that adds them to the labels set.
      <Box key="label-none-line" height={1} flexShrink={0}>
        {labelsSet.mode === 'or' ? (
          <Button key="label-none" plain onPress={() => acts.setLabelFilter(f => ({ ...f, none: f.none !== true }), NO_LABEL)}>
            <Text>{`${labelsSet.none === true ? '☑' : '☐'} ${NO_LABEL}`.padEnd(width)}</Text>
          </Button>
        ) : (
          <Button key="label-none" plain onPress={() => acts.setLabelFilter(f => ({ ...f, labels: [], none: true, not: [] }), NO_LABEL)}>
            {actionText(NO_LABEL, labelsSet.none === true && labelsSet.labels.length === 0 && leftOut(labelsSet).length === 0, width)}
          </Button>
        )}
      </Box>,
      // A press steps the box: ☐ set ☑, left out ☒, then ☐ again (#99, decided 7).
      ...labels.map((l: Label, k) => {
        const on = labelsSet.labels.includes(l.name)
        const out = leftOut(labelsSet).includes(l.name)
        const shortName = fit(l.name, width - 2)
        return (
          <Box key={`label-line-${k}`} height={1} flexShrink={0}>
            <Button
              key={`toggle-label-${k}`}
              plain
              onPress={() =>
                acts.setLabelFilter(f => stepLabel(f, l.name), `${on ? 'leave out' : out ? 'unset' : 'set'} ${l.name}`)
              }
            >
              <Text>
                {on ? '☑ ' : out ? '☒ ' : '☐ '}
                {d.labelTexts([{ name: shortName, color: l.color }])}
                {' '.repeat(Math.max(0, width - 2 - shortName.length))}
              </Text>
            </Button>
          </Box>
        )
      }),
    ]
    listShown.set(id, { list: 'labels', lines: lines.length, room: overlayRoom(top) - 1, first: 3 })
    return overlay('labels-list', width, lines, p.place.labels?.scroll ?? 0, head, top)
  }
  // What a list draws over its rows: the milestone filter's list, open,
  // ▸ All and ▸ No milestone, then each milestone with its due date, the
  // one set in bold (#99, decided 6d); or the menu.
  const listOverlay = async (withFilter = true) => {
    const top = 1
    if (withFilter && setOption !== undefined && p.place.labels) return labelFilterList(top)
    const listOpen = withFilter && shownFilter !== null && setOption !== undefined && p.shown.filterOpen
    if (listOpen && shownFilter) {
      return overlay(
        'choices',
        20,
        shownFilter.options.map(o => (
          <Box key={`choice-${filterKey(o.filter)}`} height={1} flexShrink={0}>
            <Button key={`milestone-${filterKey(o.filter)}`} plain onPress={() => acts.setFilter(o.filter, o.label)}>
              {o.filter.kind === 'milestone' ? (
                <Text bold={sameFilter(o.filter, shownFilter.set)}>
                  {fit(o.label, 13).padEnd(14)}
                  {d.dueDate('due', o.due ?? null, look.today, { form: 'short', bare: true, width: 6 })}
                </Text>
              ) : (
                actionText(o.label, sameFilter(o.filter, shownFilter.set), 20)
              )}
            </Button>
          </Box>
        )),
        undefined,
        null,
        top,
      )
    }
    return menuLines([refreshAction, helpAction], undefined, top)
  }
  // A list: its title row, its rows, then what sits above the bottom line
  // (`last`), the bottom line and what the list draws over its rows.
  const listFrame = async (top: RenderChildren, rows: RenderChildren[], over: RenderChildren, last: RenderChildren = null) => (
    <Box flexDirection="column" height={height}>
      {top}
      <Box key="gap" height={1} flexShrink={0} />
      <Box key="list" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {rows}
      </Box>
      {last}
      {bottomRule}
      {counter}
      {over}
    </Box>
  )
  // A detail: its top row, which stays, then its rows, scrolled by the mod
  // (DRAWING.md, A detail scrolls), then the bottom line, which stays.
  const detailFrame = (top: RenderChildren, body: RenderChildren[], over: RenderChildren) => {
    const shown = measure(body)
    const room = Math.max(1, height - measure(top).rows - 1 - 2 - (counter ? 1 : 0))
    const offset = Math.min(Math.max(0, shown.rows - room), p.place.scroll)
    views.set(id, { rows: shown.rows, room, at: shown.at })
    return (
      <Box flexDirection="column" height={height}>
        {top}
        <Box key="gap" height={1} flexShrink={0} />
        <Box key="detail" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {/* As tall as its rows, measured, and moved up by a negative margin:
              without a height the engine fits it to the room and squeezes rows
              out of it, and a placed Box's negative top it does not keep. */}
          <Box key="rows" marginTop={-offset} width={columns} height={shown.rows} flexShrink={0} flexDirection="column">
            {body}
          </Box>
        </Box>
        {bottomRule}
        {counter}
        {over}
      </Box>
    )
  }
  // A detail's top row: its hotkeys, [ ← ] that goes `back`, then `extra`
  // (Prompt on an issue) and the menu.
  const detailTop = (actions: readonly Action[], back: () => unknown, extra: RenderChildren = null) => (
    <Box key="top" flexDirection="column" flexShrink={0}>
      <Box key="title" height={1} flexShrink={0}>
        {hotkeys(actions, 'back')}
        <Button key="back" label="←" hotkey="b" onPress={back} />
        <Box flexGrow={1} />
        {extra}
        {extra && <Box width={2} />}
        {menuButton}
      </Box>
    </Box>
  )
  // A heading with, on its right, the pane's own action when it has one.
  const heading = (text: string, action?: { label: string }) => (
    <Box key="title" height={1} flexShrink={0}>
      {text && (
        <Text bold wrap="truncate-end">
          {text}
        </Text>
      )}
      <Box flexGrow={1} />
      {action && <Button key="refresh" label={action.label} hotkey="r" onPress={acts.refresh} />}
    </Box>
  )
  return { refreshAction, helpAction, menuLines, overlay, overlayRoom, rowOf, titleRow, listOverlay, listFrame, detailFrame, detailTop, heading }
}
