import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Hook, Register, RenderInput, Timer } from 'claude-code'

import type { Comment, Detail, Epic, IssueDetail, IssueRow, Issues, Label, LabelFilter, Milestone, MilestoneFilter, Overview, ParentChoices, Ref, Repo, RepoLabels, Setup, TokenSource, Where } from '../types'
import { draw, type Look } from './draw'
import { inMilestone } from './epics'
import { configureCommand, type Forge, type TokenSetting } from './forge'
import { ALL, filterWord, isAll, NO_LABELS, sameFilter } from './filter'
import { changesSince, loadRepo, noteChange, noteParents, parentsSince, type Known } from './load'
import { anyToken, checkForge, findRepo, trackerFor, type Tokens } from './setup'
import { message, slug, type Send, type Tracker } from './tracker'
import * as step from './where'
import { HERE, issueOf, milestoneOf } from './where'
import { ISSUES_PANE, MILESTONES_PANE, PANE } from './panes'
import { frame, hidden, listShown, views, type Acts, type Pane, type Shown } from './views/frame'
import { helpView } from './views/help'
import { issueView } from './views/issue'
import { issuesView } from './views/issues'
import { milestonesView } from './views/milestones'
import { nextView } from './views/next'
import { compactChoice, iconsChoice, setupView } from './views/setup'

// The command, and the one it falls back to when another has /next.
const COMMAND = 'next'
const FALLBACK_COMMAND = 'whats-next'

const repo = atom({ plugin: 'whats-next', key: 'repo' } as const, null)
const version = atom({ plugin: 'whats-next', key: 'version' } as const, null)
const token = atom({ plugin: 'whats-next', key: 'token' } as const, null)
const setup = atom({ plugin: 'whats-next', key: 'setup' } as const, { kind: 'checking' })
const overview = atom({ plugin: 'whats-next', key: 'overview' } as const, { kind: 'idle' })
// Per pane, keyed by its id: what was loaded for the issue it shows. Each
// pane opens issues in a detail of its own; where it is, hooks/panes.ts.
const detail = atom({ plugin: 'whats-next', key: 'detail' } as const, { kind: 'idle' })
const parentChoices = atom({ plugin: 'whats-next', key: 'parentChoices' } as const, { kind: 'idle' })
const spinner = atom({ plugin: 'whats-next', key: 'spinner' } as const, 0)
const iconsChosen = atom({ plugin: 'whats-next', key: 'icons' } as const, null)
const compactChosen = atom({ plugin: 'whats-next', key: 'compact' } as const, null)
const issues = atom({ plugin: 'whats-next', key: 'issues' } as const, { kind: 'idle' })
const unfolded = atom({ plugin: 'whats-next', key: 'unfolded' } as const, [])
const treeKids = atom({ plugin: 'whats-next', key: 'treeKids' } as const, {})
const issuesFolded = atom({ plugin: 'whats-next', key: 'issuesFolded' } as const, false)
const descriptionUnfolded = atom({ plugin: 'whats-next', key: 'descriptionUnfolded' } as const, false)
const milestones = atom({ plugin: 'whats-next', key: 'milestones' } as const, null)
const milestonesUnfolded = atom({ plugin: 'whats-next', key: 'milestonesUnfolded' } as const, [])
const milestoneError = atom({ plugin: 'whats-next', key: 'milestoneError' } as const, null)
const msIssues = atom({ plugin: 'whats-next', key: 'milestoneIssues' } as const, {})
const closedMilestones = atom({ plugin: 'whats-next', key: 'closedMilestones' } as const, [])
const closedShown = atom({ plugin: 'whats-next', key: 'closedShown' } as const, false)
const panesOpen = atom({ plugin: 'whats-next', key: 'panesOpen' } as const, [])
const filterChosen = atom({ plugin: 'whats-next', key: 'filterChosen' } as const, null)
const filterShown = atom({ plugin: 'whats-next', key: 'filterShown' } as const, null)
const filterOpen = atom({ plugin: 'whats-next', key: 'filterOpen' } as const, false)
const labelFilter = atom({ plugin: 'whats-next', key: 'labelFilter' } as const, { labels: [], mode: 'and' })
const repoLabels = atom({ plugin: 'whats-next', key: 'repoLabels' } as const, { kind: 'idle' })
const childrenToo = atom({ plugin: 'whats-next', key: 'childrenToo' } as const, true)
const requests = atom({ plugin: 'whats-next', key: 'requests' } as const, null)
// Per pane, keyed by its id: where it is (hooks/where.ts).
const where = atom({ plugin: 'whats-next', key: 'where' } as const, HERE)

// Where pane `pane` is, and the pane moved by one of where.ts's steps.
function placeOf($: EngineInterface, pane: string): Promise<Where> {
  return read($, memberOf(where, { requestId: pane }))
}
function go($: EngineInterface, pane: string, change: (w: Where) => Where) {
  return update($, memberOf(where, { requestId: pane }), change)
}
// The milestone the Milestones pane has open, null when it shows its list.
async function milestoneShown($: EngineInterface) {
  return milestoneOf(await placeOf($, MILESTONES_PANE))
}

// Every request What's Next sends the forge, counted, so Debug can say what each action cost.
let requestsMade = 0
function send($: EngineInterface): Send {
  return (url, init) => {
    requestsMade++
    return $.http.fetch(url, init)
  }
}

// The forge each host runs, as setup's check found it.
const forges = new Map<string, Forge>()

// The tracker behind repo `r`, as setup's check found its forge.
function tracker($: EngineInterface, r: Repo): Tracker {
  return trackerFor(send($), r, forges.get(r.host), configTokens, configLabel)
}

// Runs an action and records how many requests it sent, under `label`.
async function counted<T>($: EngineInterface, label: string, action: () => Promise<T>): Promise<T> {
  const before = requestsMade
  const result = await action()
  const count = requestsMade - before
  await update($, requests, last => ({ label, count, total: (last?.total ?? 0) + count }))
  return result
}

// The token settings' text, read in `register`; a reload reads them again.
const configTokens: Tokens = {
  'Forgejo tokens': '',
  'GitLab.com token': '',
  'Private GitLab token': '',
  'GitHub token': '',
}
// The Icons setting: ask, icons or text.
let configIcons = 'ask'
// The Compact setting: ask, on or off.
let configCompact = 'ask'
// The Epic label setting: the label that makes an issue an epic.
let configLabel = 'epic'
// The Debug setting: count What's Next's requests on a line under the bottom line.
let configDebug = false
// The command that sets a token, with the marketplace What's Next was
// installed from once session.start has read it off /config.
let configure = configureCommand([])

// The /config row key of What's Next's setting `field`: `whats-next.<field>`
// from a folder, else `whats-next@<marketplace>.<field>`, and a marketplace
// name may hold a dot (`configureCommand` reads the same keys).
const settingKey = (field: string) => new RegExp(`^whats-next(@.*)?\\.${field}$`)

// A choice of Icons or Compact, as setup's question asks it.
type Choice = { field: 'icons'; value: 'icons' | 'text' } | { field: 'compact'; value: 'on' | 'off' }

// Saves a choice: in the session's state, so it shows at once, and in /config
// where the session offers the setting. Each atom is written out, as the
// scan that validates a hook reads them.
async function chooseSetting($: EngineInterface, choice: Choice) {
  if (choice.field === 'icons') await update($, iconsChosen, () => choice.value)
  else await update($, compactChosen, () => choice.value)
  const keys = new Set((await $.config.list()).map(r => r.key))
  const done = await saveChoice($, keys, choice)
  if (done?.deny !== undefined) $.ui.toast(`${choice.field === 'icons' ? 'Icons' : 'Compact'} not saved: ${done.deny}`)
}

// Writes a choice to its /config row among `keys`, the rows the session
// offers: What's Next from a folder, from its marketplace, or from the
// directory (`synced`). Each key is written out, as the directory reads a
// setting's key only as fixed text at the call; from any other marketplace
// the choice holds for the session only. docs/check-marketplace.sh knows
// these keys name the marketplace.
async function saveChoice($: EngineInterface, keys: Set<string>, choice: Choice) {
  if (choice.field === 'icons') {
    if (keys.has('whats-next.icons')) return $.config.set({ key: 'whats-next.icons', value: choice.value })
    if (keys.has('whats-next@egribnau.icons')) return $.config.set({ key: 'whats-next@egribnau.icons', value: choice.value })
    if (keys.has('whats-next@synced.icons')) return $.config.set({ key: 'whats-next@synced.icons', value: choice.value })
  } else {
    if (keys.has('whats-next.compact')) return $.config.set({ key: 'whats-next.compact', value: choice.value })
    if (keys.has('whats-next@egribnau.compact')) return $.config.set({ key: 'whats-next@egribnau.compact', value: choice.value })
    if (keys.has('whats-next@synced.compact')) return $.config.set({ key: 'whats-next@synced.compact', value: choice.value })
  }
  return null
}

// Each step in turn, stopping at the first that fails (hooks/setup.ts has
// the steps): this reads `git`, keeps what each step found and passes the
// settings in.
async function check($: EngineInterface): Promise<Repo | null> {
  await update($, setup, (): Setup => ({ kind: 'checking' }))
  await update($, token, () => anyToken(configTokens))

  const git = async (...args: string[]) => {
    const run = await $.process.run(['git', ...args]).catch(() => null)
    return run?.exitCode === 0 ? run.stdout.trim() : null
  }
  const url = await git('remote', 'get-url', 'origin')
  const found = await findRepo(url, async () => {
    const inRepo = url !== null || (await git('rev-parse', '--is-inside-work-tree')) === 'true'
    const pwd = await $.process.run(['pwd']).catch(() => null)
    return { inRepo, dir: (pwd?.exitCode === 0 ? pwd.stdout.trim() : 'this folder').replace(/^\/(?:Users|home)\/[^/]+/, '~') }
  })
  const r = found.repo
  await update($, repo, () => r)
  await update($, version, () => null)
  if (!r) {
    await update($, setup, () => found.setup)
    return null
  }

  const checked = await checkForge(send($), r, configTokens, configLabel, forges.get(r.host))
  forges.set(r.host, checked.forge)
  await update($, token, () => checked.token)
  await update($, version, () => checked.version)
  await update($, setup, () => checked.setup)
  return r
}

// What is known of the repo, built by each load and kept until the next
// Refresh or /next; while a load asks again, the last one's.
let known: Known | null = null

// Asks the tracker for what the panes show: the open milestones, your open
// issues, the repo's open issues, and the epics. Then the milestones, the
// milestone filter, What's next and Issues follow. What was known before
// goes to What's next, which tells an issue that left the lists from one
// that was never in them.
async function load($: EngineInterface, r: Repo) {
  const before = known
  if ((await read($, overview)).kind !== 'ok') await update($, overview, (): Overview => ({ kind: 'loading' }))
  if ((await read($, issues)).kind !== 'ok') await update($, issues, (): Issues => ({ kind: 'loading' }))
  const s = await read($, setup)
  const ready = s.kind === 'ready'
  const loaded = await loadRepo(tracker($, r), {
    me: ready ? s.login : null,
    features: ready ? s.features : { time: true, deps: true, epics: true },
    changes: changesSince(`${r.host}/${slug(r)}`, await $.clock.now()),
    parents: parentsSince(`${r.host}/${slug(r)}`, await $.clock.now()),
  })
  const { issuesError, epicsError } = loaded
  if (issuesError !== null) await update($, overview, (): Overview => ({ kind: 'error', message: issuesError }))
  const issuesFailed = issuesError ?? epicsError
  if (issuesFailed !== null) await update($, issues, (): Issues => ({ kind: 'error', message: issuesFailed }))
  known = loaded
  await update($, milestones, () => loaded.milestones)
  await update($, closedMilestones, () => loaded.closedMilestones)
  await showFilter($)
  if (issuesError === null) await showNext($, before)
  if (issuesFailed === null) await showIssues($)
  // The milestones folded open, and the one in its detail, are asked again;
  // the rest cost nothing.
  await update($, msIssues, () => ({}))
  const asked = await read($, milestonesUnfolded)
  const inDetail = await milestoneShown($)
  for (const title of inDetail === null || asked.includes(inDetail) ? asked : [...asked, inDetail]) await showMilestone($, title)
}

// The open issues of milestone `title`, for the Milestones pane.
async function showMilestone($: EngineInterface, title: string) {
  if (!known) return
  const issues = await known.milestone(title)
  await update($, msIssues, shown => ({ ...shown, [title]: issues }))
  await showTree($)
}

// The open epics at the top of a group's tree, as the trees start.
const topOf = (l: Parameters<typeof inMilestone>[0]): Epic[] =>
  inMilestone(l).epics.map(e => ({ number: e.number, title: e.title, state: e.state, due: e.due, children: e.children ?? null }))

// The children every tree shown needs, as far as it is folded open: the
// Issues pane's, each milestone's folded open, and the one in its detail.
async function showTree($: EngineInterface) {
  if (!known) return
  const shown = await read($, issues)
  const trees: Epic[][] = shown.kind === 'ok' ? shown.groups.map(g => topOf(g.issues)) : []
  const issuesOf = await read($, msIssues)
  const inDetail = await milestoneShown($)
  for (const title of new Set([...(await read($, milestonesUnfolded)), ...(inDetail === null ? [] : [inDetail])])) {
    const listed = issuesOf[title]
    if (listed) trees.push(topOf(listed))
  }
  const kids = await known.grow(trees, new Set(await read($, unfolded)))
  await update($, treeKids, () => kids)
}

// Folds milestone `title` open or shut; open the first time, its issues are asked.
async function foldMilestone($: EngineInterface, title: string) {
  const was = await read($, milestonesUnfolded)
  await update($, milestonesUnfolded, () => (was.includes(title) ? was.filter(t => t !== title) : [...was, title]))
  if (!known || was.includes(title) || title in (await read($, msIssues))) return
  await counted($, title, () => showMilestone($, title))
}

// Opens milestone `title` in its detail, or the list again for null. Its
// issues are asked unless a fold already did.
// It opens as its rules say, every time (DRAWING.md, A detail scrolls).
async function openMilestone($: EngineInterface, title: string | null) {
  await go($, MILESTONES_PANE, w => step.openMilestone(w, title))
  await update($, milestoneError, () => null)
  await update($, issuesFolded, () => false)
  await update($, descriptionUnfolded, () => false)
  if (!known || title === null || title in (await read($, msIssues))) return
  await counted($, title, () => showMilestone($, title))
}

// Closes milestone `m`, or opens it again, then shows the list, read again,
// where it moved to Closed or back. A refusal keeps the detail open, shown
// under its actions.
async function closeMilestone($: EngineInterface, m: Milestone, closed: boolean) {
  if (!known) return
  const why = await known.tracker.closeMilestone(m, closed)
  if (why !== null) {
    await update($, milestoneError, () => `Could not ${closed ? 'close' : 'reopen'} ${m.title}: ${why.replace(/\.$/, '')}.`)
    return
  }
  await openMilestone($, null)
  await refresh($)
}

// The milestone filter's options from what is open, and what it is set to:
// the person's choice while it is still offered, else where you work
// (docs/ORDERING.md).
async function showFilter($: EngineInterface) {
  if (!known) return
  const options = known.options()
  const wanted = await read($, filterChosen)
  const set = options.find(o => sameFilter(wanted, o.filter))?.filter ?? (await known.startingFilter(options, await $.clock.now()))
  await update($, filterShown, () => ({ options, set }))
}

// What the milestone filter is set to, All until it is loaded.
async function filterSet($: EngineInterface): Promise<MilestoneFilter> {
  return (await read($, filterShown))?.set ?? ALL
}

// What's next within the milestone filter. `before`: what was known before
// a load; without it (the milestone filter switching) nothing left the lists.
async function showNext($: EngineInterface, before: Known | null = null) {
  const k = known
  if (!k) return
  const next = await k.whatsNext(await filterSet($), await $.clock.now(), await read($, labelFilter))
  await update($, overview, (): Overview => ({ kind: 'ok', ...next }))
  // An issue the pane listed open before the load, and lists open no more
  // (closed, or taken by someone else), closes: What's next shows. One it
  // opened on purpose from elsewhere, the Last closed issue or one reached
  // through Blocked by or Blocks, stays.
  await go($, PANE, w => {
    const n = issueOf(w)
    return n !== null && before !== null && before.listedOpen(n) && !k.listedOpen(n) ? step.closed(w) : w
  })
}

// The open issues within the milestone filter, by milestone. What was shown
// stays up while this loads, so the milestone filter does not vanish under
// the person's hand.
async function showIssues($: EngineInterface) {
  if (!known) return
  const groups = await known.issues(await filterSet($))
  if (groups === null) return
  await update($, issues, (): Issues => ({ kind: 'ok', groups, openIssues: known?.openIssues() ?? 0 }))
  await showTree($)
}

// Folds issue `n` open or shut in a tree; open, the children it now shows
// are asked for, those not asked before.
async function foldIssue($: EngineInterface, n: number) {
  const was = await read($, unfolded)
  await update($, unfolded, () => (was.includes(n) ? was.filter(x => x !== n) : [...was, n]))
  if (!known || was.includes(n)) return
  await counted($, `#${n}`, () => showTree($))
}

// Sets the milestone filter for both panes and closes its list.
async function setFilter($: EngineInterface, filter: MilestoneFilter, label: string) {
  await update($, filterOpen, () => false)
  await update($, filterChosen, () => filter)
  if (!known) return
  await counted($, label, async () => {
    await showFilter($)
    if ((await read($, overview)).kind === 'ok') await showNext($)
    await showIssues($)
  })
}

// Sets the label filter for both panes, by `change`; its list stays open
// for the next. What's next follows; Issues draws from what it has.
async function setLabelFilter($: EngineInterface, change: (f: LabelFilter) => LabelFilter, label: string) {
  await update($, labelFilter, f => change(Array.isArray(f?.labels) ? f : NO_LABELS))
  if (!known) return
  await counted($, label, async () => {
    if ((await read($, overview)).kind === 'ok') await showNext($)
  })
}

// The issues read for a detail view, by repo and number, kept until the next
// Refresh or /next, so opening one again asks Forgejo nothing.
const issuesRead = new Map<string, IssueDetail>()

// Reads issue `n` for the detail view of pane `pane`, or shows it from memory.
// `quiet`: the detail shown stays until the new one is read, with no
// Loading … between, as after a label's change with the labels list open.
// Refusal `error` in red under the heading of pane `pane`'s detail, or
// none for null. Only a new action or Refresh takes it away: a detail read
// again keeps it, as a press made before it may finish after it.
async function showRefusal($: EngineInterface, pane: string, error: string | null) {
  await update($, memberOf(detail, { requestId: pane }), (d): Detail => (d.kind === 'ok' ? { ...d, error: error ?? undefined } : d))
}

async function loadDetail($: EngineInterface, r: Repo, pane: string, n: number, quiet = false) {
  const k = known
  // A refusal shown on this issue stays (showRefusal), and so does a wait.
  const kept = (d: Detail) => (d.kind === 'ok' && d.issue.number === n ? d.error : undefined)
  const still = (d: Detail) => (d.kind === 'ok' && d.issue.number === n && waits.has(pane) ? d.busy : undefined)
  if (!k) return
  const key = `${r.host}/${slug(r)}#${n}`
  const cached = issuesRead.get(key)
  // The issues it is a child of, from what the lists know: one request the
  // first time, none once Next has asked.
  const parentsOf = () => k.parents(n)
  // Whether it waits on an open issue that is not its own child, for its mark.
  const blockedOf = (i: IssueDetail) => k.blocked(i, (i.blockedBy ?? []).filter(x => x.state === 'open').map(x => x.number))
  // The issues it holds, for its Children lines: an epic's, or on GitHub
  // any issue's sub-issues.
  const childrenOf = async (): Promise<Ref[] | null> => {
    const all = await k.children(n)
    return all ? all.map(c => ({ number: c.number, title: c.title, state: c.state, assignees: c.assignees, blocked: c.blocked, milestone: c.milestone })) : null
  }
  if (cached) {
    const [parents, blocked, children] = await Promise.all([parentsOf(), blockedOf(cached), childrenOf()])
    await update($, memberOf(detail, { requestId: pane }), (d): Detail => ({ kind: 'ok', issue: cached, parents, blocked, children, error: kept(d), busy: still(d) }))
    return
  }
  if (!quiet) await update($, memberOf(detail, { requestId: pane }), (): Detail => ({ kind: 'loading', number: n }))
  try {
    const [issue, parents, children] = await Promise.all([k.issue(n), parentsOf(), childrenOf()])
    const blocked = await blockedOf(issue)
    issuesRead.set(key, issue)
    // Another issue opened while this one loaded wins.
    if (issueOf(await placeOf($, pane)) !== n) return
    await update($, memberOf(detail, { requestId: pane }), (d): Detail => ({ kind: 'ok', issue, parents, blocked, children, error: kept(d), busy: still(d) }))
  } catch (err) {
    if (issueOf(await placeOf($, pane)) !== n) return
    await update($, memberOf(detail, { requestId: pane }), (): Detail => ({ kind: 'error', number: n, message: message(err) }))
  }
}

// Opens issue `n` in the detail of pane `pane`, from its list: Back goes to
// the list.
async function openIssue($: EngineInterface, pane: string, n: number) {
  await go($, pane, w => step.open(w, n))
  await loadIssue($, pane, n)
}

// The help page (DRAWING.md, The help page) in pane `pane`, over what it
// shows, at its top; Back returns to that, as it was.
async function showHelp($: EngineInterface, pane: string) {
  if ((await placeOf($, pane)).help) return
  await go($, pane, step.help)
  await update($, filterOpen, () => false)
}

function leaveHelp($: EngineInterface, pane: string) {
  return go($, pane, step.leaveHelp)
}

// Opens issue `n` in pane `pane`, reached from the one shown through its
// Blocked by or Blocks: Back returns to that one.
async function followIssue($: EngineInterface, pane: string, n: number) {
  await go($, pane, w => step.follow(w, n))
  await loadIssue($, pane, n)
}

// Back: the issue the open one was reached from, else the list.
async function goBack($: EngineInterface, pane: string) {
  await go($, pane, step.back)
  await loadIssue($, pane, issueOf(await placeOf($, pane)))
}

// Loads issue `n` for pane `pane`, which has moved to it; null shows no detail.
async function loadIssue($: EngineInterface, pane: string, n: number | null) {
  const r = await read($, repo)
  if (n === null || !r) {
    await update($, memberOf(detail, { requestId: pane }), (): Detail => ({ kind: 'idle' }))
    return
  }
  await counted($, `#${n}`, () => loadDetail($, r, pane, n))
}

// Pane `pane` shows its list again: What's next, Issues or Milestones.
async function backToList($: EngineInterface, pane: string) {
  await go($, pane, step.list)
  await update($, memberOf(detail, { requestId: pane }), (): Detail => ({ kind: 'idle' }))
}

// Checks setup and, once it passes, loads What's next and Issues and,
// where an issue is open, that issue again. The Issues and Milestones panes
// follow what the load found (`followPane`), unless `follow` is off: /next
// opens them itself, in its own order, once What's next is placed.
async function refresh($: EngineInterface, follow = true): Promise<Repo | null> {
  issuesRead.clear()
  for (const pane of [PANE, ISSUES_PANE, MILESTONES_PANE]) await showRefusal($, pane, null)
  await update($, repoLabels, (): RepoLabels => ({ kind: 'idle' }))
  await update($, childrenToo, () => true)
  const r = await check($)
  if (r && (await read($, setup)).kind === 'ready') {
    const before = await read($, issues)
    const hadMilestones = ((await read($, milestones)) ?? []).length > 0
    await load($, r)
    const after = await read($, issues)
    if (follow && after.kind === 'ok') {
      await followPane($, ISSUES_PANE, 'Issues', before.kind === 'ok' && before.openIssues > 0, after.openIssues > 0)
    }
    if (follow) await followPane($, MILESTONES_PANE, 'Milestones', hadMilestones, ((await read($, milestones)) ?? []).length > 0)
    for (const pane of [PANE, ISSUES_PANE, MILESTONES_PANE]) {
      const n = issueOf(await placeOf($, pane))
      if (n !== null) await loadDetail($, r, pane, n)
      else await update($, memberOf(detail, { requestId: pane }), (): Detail => ({ kind: 'idle' }))
    }
    // A labels list open is asked for again, and the labels' colours while
    // the label filter is set to some.
    const panes = [PANE, ISSUES_PANE, MILESTONES_PANE]
    const open = (await Promise.all(panes.map(async pane => (await placeOf($, pane)).labels))).some(Boolean)
    if (open || !isAll(await read($, labelFilter))) await loadLabels($)
  } else {
    await update($, overview, (): Overview => ({ kind: 'idle' }))
    await update($, issues, (): Issues => ({ kind: 'idle' }))
  }
  return r
}

// The Issues or Milestones pane, `id`, follows a load that found the first
// open issue or milestone (`had` none before, `has` one now), or none left:
// it opens as a tab next to What's next, without the focus, or closes. A
// pane the person closed while there was something to show stays closed
// until /next. One opened without the person asking (a reload) may wait
// undrawn on a narrow terminal; the next Refresh, which they ask for, opens
// it again so it is drawn.
async function followPane($: EngineInterface, id: string, title: string, had: boolean, has: boolean) {
  // The engine's record says whether it is drawn; without it, What's Next's own
  // list of open panes, taken as drawn.
  const panes = await $.ui.panes().catch(async () => (await read($, panesOpen)).map(id => ({ id, isPlaced: true })))
  const pane = panes.find(p => p.id === id)
  if (has && (pane ? !pane.isPlaced : !had)) {
    await $.ui.open({ id, title })
    await update($, panesOpen, ids => (ids.includes(id) ? ids : [...ids, id]))
  } else if (!has && pane) {
    await $.ui.close({ id })
    await update($, panesOpen, ids => ids.filter(i => i !== id))
  }
}

// Opens `url` in the browser of the computer the session runs on: `open`
// on macOS, `xdg-open` elsewhere.
async function openUrl($: EngineInterface, url: string) {
  for (const cmd of ['open', 'xdg-open']) {
    const run = await $.process.run([cmd, url]).catch(() => null)
    if (run?.exitCode === 0) return
  }
  $.ui.toast(`Could not open a browser for ${url}`)
}


// Changes issue `n` with `change` (`what` names it for a refusal), then
// reads it again with What's next and Issues, so the change shows
// everywhere. Pane `pane` goes back to its list, unless it `stay`s on the
// issue; a refusal keeps the issue open there, shown under its actions.
// `after` goes after the issue's number in the refusal (` to v1.2`);
// `also`, once the change is done, the other issues it changed.
async function writeIssue(
  $: EngineInterface,
  pane: string,
  n: number,
  change: (t: Tracker) => Promise<string | null>,
  what: string,
  stay = false,
  after = '',
  also: () => number[] = () => [],
): Promise<boolean> {
  const r = await read($, repo)
  const k = known
  if (!r || !k) return false
  await showRefusal($, pane, null)
  const why = await change(k.tracker)
  if (why !== null) {
    const error = `Could not ${what} #${n}${after}: ${why.replace(/\.$/, '')}.`
    await showRefusal($, pane, error)
    return false
  }
  const key = `${r.host}/${slug(r)}#${n}`
  issuesRead.delete(key)
  const others = also()
  for (const o of others) issuesRead.delete(`${r.host}/${slug(r)}#${o}`)
  if (!stay) await backToList($, pane)
  for (const p of [PANE, ISSUES_PANE, MILESTONES_PANE]) {
    if (issueOf(await placeOf($, p)) === n) await loadDetail($, r, p, n, stay && p === pane)
  }
  // The issue as the change left it, read again unless a pane just did, so
  // the lists show the change even where the forge's lists lag it.
  const fresh = issuesRead.get(key) ?? (await k.issue(n).catch(() => null))
  if (fresh) noteChange(`${r.host}/${slug(r)}`, fresh, await $.clock.now())
  for (const o of others) {
    const read = await k.issue(o).catch(() => null)
    if (read) noteChange(`${r.host}/${slug(r)}`, read, await $.clock.now())
  }
  await load($, r)
  return true
}

// You on issue `i`, or off it; other assignees stay.
async function assignMe($: EngineInterface, pane: string, i: IssueDetail, on: boolean): Promise<boolean> {
  const me = known?.me
  if (!me) return false
  const others = i.assignees.filter(a => a !== me)
  const assignees = on ? [...others, me] : others
  return writeIssue($, pane, i.number, t => t.assign(i.number, assignees), on ? 'assign' : 'unassign')
}

// The repo's labels for the labels list, by name, read once until Refresh.
async function loadLabels($: EngineInterface) {
  const r = await read($, repo)
  const k = known
  if (!r || !k) return
  const at = `${r.host}/${slug(r)}`
  await update($, repoLabels, (): RepoLabels => ({ kind: 'loading', repo: at }))
  try {
    const all = await k.tracker.labels()
    const labels = [...all].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    await update($, repoLabels, (): RepoLabels => ({ kind: 'ok', repo: at, labels }))
  } catch (err) {
    await update($, repoLabels, (): RepoLabels => ({ kind: 'error', repo: at, message: message(err) }))
  }
}

// The labels list of pane `pane` opened, or shut; opened, the repo's labels
// are asked for unless they are known (DRAWING-issue.md, The labels list).
async function toggleLabels($: EngineInterface, pane: string) {
  await update($, filterOpen, () => false)
  await go($, pane, step.toggleLabels)
  if (!(await placeOf($, pane)).labels) return
  const r = await read($, repo)
  const had = await read($, repoLabels)
  if (r && (had.kind === 'ok' || had.kind === 'loading') && had.repo === `${r.host}/${slug(r)}`) return
  await counted($, 'Labels', () => loadLabels($))
}

// Panes whose detail waits on the forge, each with the press it waits for,
// so a press that finishes late ends only its own wait.
const waits = new Map<string, symbol>()

// The spinner's timer while any pane waits; the frame it turns to, the
// spinner atom.
let spinning: Timer | null = null
const SPIN_MS = 120

// Pane `pane`'s detail waiting on the forge for its `list`, its spinner
// turning (DRAWING-issue.md, The labels list): a function that ends this
// wait, or null when it waits already and the press is passed over.
async function wait($: EngineInterface, pane: string, list: 'labels' | 'milestones' | 'parents') {
  if (waits.has(pane)) return null
  const mine = Symbol(pane)
  waits.set(pane, mine)
  const at = memberOf(detail, { requestId: pane })
  await update($, at, (d): Detail => (d.kind === 'ok' ? { ...d, busy: { list } } : d))
  spinning ??= $.clock.every(SPIN_MS, () => void update($, spinner, n => n + 1))
  return async () => {
    if (waits.get(pane) !== mine) return
    waits.delete(pane)
    if (waits.size === 0) {
      spinning?.cancel()
      spinning = null
    }
    await update($, at, (d): Detail => (d.kind === 'ok' ? { ...d, busy: undefined } : d))
  }
}

// Label `l` added to issue `i`, or taken off; the tick moves at once, and
// the pane stays on the issue, its labels list open for the next, waiting
// until the forge answers (DRAWING-issue.md, The labels list).
async function setLabel($: EngineInterface, pane: string, i: IssueDetail, l: Label, on: boolean) {
  const free = await wait($, pane, 'labels')
  if (!free) return false
  try {
    const at = memberOf(detail, { requestId: pane })
    const tick = (has: boolean) =>
      update($, at, (d): Detail => {
        if (d.kind !== 'ok' || d.issue.number !== i.number) return d
        const others = d.issue.labels.filter(x => x.name !== l.name)
        return { ...d, issue: { ...d.issue, labels: has ? [...others, { name: l.name, color: l.color }] : others } }
      })
    await tick(on)
    const change = async (t: Tracker) => {
      const why = await t.label(i.number, l, on)
      await free()
      return why
    }
    const done = await writeIssue($, pane, i.number, change, on ? `add ${l.name} to` : `take ${l.name} off`, true)
    // Refused: the tick as it was, the refusal kept.
    if (!done) await tick(!on)
    return done
  } finally {
    await free()
  }
}

// The milestone list of pane `pane` opened, or shut (DRAWING-issue.md, The
// milestone list): the open milestones are known already, so nothing is asked.
async function toggleMilestones($: EngineInterface, pane: string) {
  await update($, filterOpen, () => false)
  await go($, pane, step.toggleMilestones)
}

// Issue `i` moved to milestone `m`, or out of its own for null, and with
// Children too ticked its open children in its old milestone, `children`;
// the list shuts and the pane stays on the issue (DRAWING-issue.md, The
// milestone list). The issue refused, no child is tried; a child refused,
// the rest still move, and the refusal names it.
async function setMilestone($: EngineInterface, pane: string, i: IssueDetail, m: Milestone | null, children: number[]) {
  await go($, pane, step.shutMilestones)
  const from = i.milestone?.title ?? null
  const free = await wait($, pane, 'milestones')
  if (!free) return false
  try {
    // The Milestone line shows the move at once; refused, as it was.
    const at = memberOf(detail, { requestId: pane })
    const show = (to: IssueDetail['milestone']) =>
      update($, at, (d): Detail => (d.kind === 'ok' && d.issue.number === i.number ? { ...d, issue: { ...d.issue, milestone: to } } : d))
    await show(m ? { title: m.title, due: m.due } : null)
    const done = await moveMilestone($, pane, i, m, children, from, free)
    if (!done) await show(i.milestone)
    return done
  } finally {
    await free()
  }
}

// setMilestone's move, its wait ended by `free` once the forge answered.
async function moveMilestone($: EngineInterface, pane: string, i: IssueDetail, m: Milestone | null, children: number[], from: string | null, free: () => Promise<void>) {
  const kids = (await read($, childrenToo)) ? children : []
  const moved: number[] = []
  const refused: { n: number; why: string }[] = []
  const change = async (t: Tracker) => {
    const why = await t.milestone(i.number, m)
    if (why !== null) return why
    for (const c of kids) {
      const no = await t.milestone(c, m)
      if (no === null) moved.push(c)
      else refused.push({ n: c, why: no })
    }
    await free()
    return null
  }
  const done = await writeIssue(
    $,
    pane,
    i.number,
    change,
    m ? 'move' : 'take',
    true,
    m ? ` to ${m.title}` : from ? ` out of ${from}` : ' out of its milestone',
    () => moved,
  )
  const first = refused[0]
  if (done && first) {
    const which = refused.map(x => `#${x.n}`).join(', ')
    const error = m
      ? `Moved #${i.number} to ${m.title}; could not move ${which}: ${first.why.replace(/\.$/, '')}.`
      : `Took #${i.number} out of ${from ?? 'its milestone'}; could not take ${which} out: ${first.why.replace(/\.$/, '')}.`
    await showRefusal($, pane, error)
  }
  return done
}

// The epic list of pane `pane` opened, or shut (DRAWING-issue.md, The epic
// list); opened, what it offers issue `i` is worked out from what is known,
// its `children` left out.
async function toggleParents($: EngineInterface, pane: string, i: IssueDetail, children: number[]) {
  await update($, filterOpen, () => false)
  await go($, pane, step.toggleParents)
  const k = known
  if (!(await placeOf($, pane)).parents || !k) return
  const at = memberOf(parentChoices, { requestId: pane })
  await update($, at, (): ParentChoices => ({ kind: 'loading', number: i.number }))
  const offered = await k.choices(i.number, i.milestone?.title ?? null, children)
  await update($, at, (): ParentChoices => ({ kind: 'ok', number: i.number, ...offered }))
}

// Issue `i` put under `p`, or taken out of it; for null taken out of each of
// `parents`, the ones it is under. The ticks move at once, and the pane
// stays on the issue, its epic list open for the next (DRAWING-issue.md, The
// epic list). What the forge took is remembered over its lists for a while,
// as GitHub's answer the old parent for some seconds.
async function setParent($: EngineInterface, pane: string, i: IssueDetail, p: number | null, on: boolean, parents: number[]) {
  const put = p !== null && on
  const free = await wait($, pane, 'parents')
  if (!free) return false
  try {
    const r = await read($, repo)
    const at = memberOf(detail, { requestId: pane })
    const shown = await read($, at)
    const offered = await read($, memberOf(parentChoices, { requestId: pane }))
    const was = shown.kind === 'ok' ? (shown.parents ?? []) : []
    const refOf = (n: number) =>
      was.find(x => x.number === n) ?? (offered.kind === 'ok' ? [...offered.epics, ...offered.issues].find(x => x.number === n) : undefined)
    const nested = known?.tracker.nested === true
    const tick = async (under: number[]) =>
      update($, at, (d): Detail =>
        d.kind === 'ok' && d.issue.number === i.number ? { ...d, parents: under.map(refOf).filter(x => x !== undefined) } : d,
      )
    const after = (under: number[], q: number, put: boolean) => (put ? (nested ? [q] : [...under, q]) : under.filter(x => x !== q))
    await tick(p === null ? [] : after(parents, p, put))
    let under = [...parents]
    let done = true
    const asked = p === null ? parents : [p]
    const last = asked[asked.length - 1]
    for (const q of asked) {
      const change = async (t: Tracker) => {
        const why = await t.parent(i.number, q, put)
        if (q === last) await free()
        if (why !== null) return why
        under = after(under, q, put)
        known?.setParents(i.number, under)
        if (r) noteParents(`${r.host}/${slug(r)}`, i.number, under, await $.clock.now())
        return null
      }
      done = await writeIssue($, pane, i.number, change, put ? 'put' : 'take', true, put ? ` under #${q}` : ` out of #${q}`, () => [q])
      if (!done) {
        await free()
        break
      }
    }
    // Refused: the ticks as the forge left them, the refusal kept.
    if (!done) await tick(under)
    return done
  } finally {
    await free()
  }
}

// Children too ticked if not, unticked if so.
function toggleChildrenToo($: EngineInterface) {
  return update($, childrenToo, on => !on)
}

// What a draft is made from: the issue, and its comments when known.
type DraftSource = Pick<IssueRow, 'number' | 'title' | 'url' | 'body'> & {
  commentList?: Comment[] | null
}

// The prompt What's Next drafts for an issue: what to do, where the issue is, what it
// says, and the last word on it.
function draftFor(i: DraftSource): string {
  const parts = [`Work on #${i.number}: ${i.title}\n${i.url}`]
  const body = i.body.trim()
  if (body) parts.push(body)
  const latest = i.commentList?.at(-1)
  const last = latest?.body.trim()
  if (last) parts.push(`Last comment, by ${latest?.author}:\n${last}`)
  return parts.join('\n\n')
}

// Puts the draft for `i` in the prompt box, never sending it: over an empty
// box, under what is typed there otherwise.
// With the actions allowed and the issue not yet yours, it is assigned to
// you first. Its pane goes back to its list once the draft is in, unless
// the assign was refused.
async function workOn($: EngineInterface, i: DraftSource, take?: { pane: string; issue: IssueDetail }) {
  let taken = false
  let refused = false
  if (take) {
    const s = await read($, setup)
    const me = known?.me
    if (s.kind === 'ready' && s.actions.kind !== 'read-only' && me && !take.issue.assignees.includes(me)) {
      taken = await counted($, `assign #${i.number}`, () => assignMe($, take.pane, take.issue, true))
      refused = !taken
    }
  }
  try {
    const draft = draftFor(i)
    const box = await $.prompt.read()
    const typed = box.text.trim() !== ''
    const done = await $.prompt.fill(typed ? { text: `\n\n${draft}`, mode: 'append' } : { text: draft, mode: 'replace' })
    $.ui.toast(
      done.isFilled
        ? `#${i.number} is ${taken ? 'yours and ' : ''}in the prompt: Esc to edit it there`
        : `Could not put #${i.number} in the prompt${done.refusal ? ` (${done.refusal})` : ''}`,
    )
    if (take && done.isFilled && !refused) await backToList($, take.pane)
  } catch (err) {
    $.ui.toast(`Could not put #${i.number} in the prompt: ${message(err)}`)
  }
}

// The element that last took the focus ring, by pane id.
const lastFocus = new Map<string, string | undefined>()

// A detail scrolls its own rows, between its top row and its bottom line,
// which stay in place: the wheel and the page keys move them by `e.by`.
const scrollDetail: Hook<'ui.scroll'> = async ($, e, next) => {
  const v = views.get(e.requestId)
  if (!v) return next(e)
  const max = Math.max(0, v.rows - v.room)
  await go($, e.requestId, w => step.scrollTo(w, Math.min(max, Math.max(0, w.scroll + e.by))))
  return {}
}

// Tab and the arrows pass over the hidden hotkeys: on to the first control,
// or, coming back from it, no further. A control out of a detail's view is
// scrolled into it; the last control scrolls the detail to its end, so the
// text after it is reached too, and the first to its top.
const focusMoved: Hook<'ui.focus'> = async ($, e, next) => {
  const h = hidden.get(e.requestId)
  if (e.element !== undefined && h?.keys.has(e.element)) {
    if (lastFocus.get(e.requestId) === h.first) return {}
    lastFocus.set(e.requestId, h.first)
    return next({ ...e, element: h.first })
  }
  lastFocus.set(e.requestId, e.element)
  // A line out of the labels list's, the milestone list's or the epic
  // list's view scrolls that list, not the detail.
  const listed = listShown.get(e.requestId)
  // The label filter's `and · or`, ▸ All and No label are its list's first lines, above the labels.
  if (listed?.list === 'labels' && ['label-and', 'label-or', 'label-all', 'label-none'].includes(e.element ?? '')) {
    if ((await placeOf($, e.requestId)).labels?.scroll) await go($, e.requestId, w => step.scrollLabels(w, 0))
    return next(e)
  }
  const line = /^(toggle-label|pick-milestone|pick-parent)-(\d+)$/.exec(e.element ?? '')
  const lists = { 'toggle-label': 'labels', 'pick-milestone': 'milestones', 'pick-parent': 'parents' } as const
  if (listed && line && lists[line[1] as keyof typeof lists] === listed.list) {
    const k = Number(line[2]) + listed.first
    const place = await placeOf($, e.requestId)
    const off = place[listed.list]?.scroll ?? 0
    const to = k < off ? k : k >= off + listed.room ? k - listed.room + 1 : off
    const scroll = { labels: step.scrollLabels, milestones: step.scrollMilestones, parents: step.scrollParents }[listed.list]
    if (to !== off) await go($, e.requestId, w => scroll(w, to))
    return next(e)
  }
  const v = views.get(e.requestId)
  const row = e.element === undefined ? undefined : v?.at.get(e.element)
  if (v && row !== undefined) {
    const off = (await placeOf($, e.requestId)).scroll
    const rows = [...v.at.values()]
    const to =
      row === Math.max(...rows)
        ? Math.max(0, v.rows - v.room)
        : row === Math.min(...rows)
          ? 0
          : row < off
            ? row
            : row >= off + v.room
              ? row - v.room + 1
              : off
    if (to !== off) await go($, e.requestId, w => step.scrollTo(w, to))
  }
  return next(e)
}

// A pane closing, by What's Next or by the person: the other one, now without a tab,
// names itself in its title row again.
const paneClosed: Hook<'ui.close'> = async ($, e, next) => {
  await update($, panesOpen, ids => ids.filter(id => id !== e.id))
  await go($, e.id, step.dropHelp)
  return next(e)
}

// A change to Icons or Compact in /config, or by What's Next's own choice buttons:
// the session follows it, so the setting wins over an earlier choice.
const settingChanged: Hook<'config.set'> = async ($, e, next) => {
  const done = await next(e)
  const field = settingKey('(icons|compact)').exec(e.key)?.[2]
  const value = String(e.value)
  if (field === 'icons' && (value === 'icons' || value === 'text' || value === 'ask')) {
    configIcons = value
    await update($, iconsChosen, () => (value === 'ask' ? null : value))
  }
  if (field === 'compact' && (value === 'on' || value === 'off' || value === 'ask')) {
    configCompact = value
    await update($, compactChosen, () => (value === 'ask' ? null : value))
  }
  return done
}

// What's Next's own version and repository, from its manifest, read once by
// the code that runs: a session keeps the version it loaded until
// /reload-plugins, even when the folder on disk has moved on. Each is null
// where the manifest has none or could not be read.
type Built = { version: string | null; repository: string | null }
let ownManifest: Promise<Built> | null = null
function builtManifest($: EngineInterface): Promise<Built> {
  const word = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const from = (path: string) =>
    $.fs.read(path).then(text => {
      const m = JSON.parse(text) as { version?: unknown; repository?: unknown }
      return { version: word(m.version), repository: word(m.repository) }
    })
  // The plugin's folder, or the .claude-plugin folder in it.
  const root = $.plugin.root
  ownManifest ??= from(`${root}/.claude-plugin/plugin.json`)
    .catch(() => from(`${root}/plugin.json`))
    .catch(() => ({ version: null, repository: null }))
  return ownManifest
}

// The session's state a view draws, for pane `e`, read once per render: the
// views take no engine (hooks/views/frame.tsx).
async function shownState($: EngineInterface, e: RenderInput<'Pane'>): Promise<Shown> {
  return {
    repo: await read($, repo),
    version: await read($, version),
    token: await read($, token),
    setup: await read($, setup),
    overview: await read($, overview),
    spinner: await read($, spinner),
    issues: await read($, issues),
    panesOpen: await read($, panesOpen),
    filterOpen: await read($, filterOpen),
    repoLabels: await read($, repoLabels),
    childrenToo: await read($, childrenToo),
    unfolded: await read($, unfolded),
    treeKids: await read($, treeKids),
    issuesFolded: await read($, issuesFolded),
    descriptionUnfolded: await read($, descriptionUnfolded),
    milestones: await read($, milestones),
    milestonesUnfolded: await read($, milestonesUnfolded),
    milestoneIssues: await read($, msIssues),
    closedMilestones: await read($, closedMilestones),
    closedShown: await read($, closedShown),
    milestoneError: await read($, milestoneError),
    detail: await read($, memberOf(detail, e)),
    parentChoices: await read($, memberOf(parentChoices, e)),
    milestoneShown: await milestoneShown($),
  }
}

// Every pane draws here: it reads the look once, then picks the view that
// draws what the pane shows (hooks/views).
async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  // A list draws no detail; the detail below sets its own again.
  views.delete(e.requestId)
  hidden.delete(e.requestId)
  listShown.delete(e.requestId)
  const id = e.requestId
  const r = await read($, repo)
  const s = await read($, setup)
  const m = await read($, overview)
  const icons = (await read($, iconsChosen)) ?? configIcons
  const compact = (await read($, compactChosen)) ?? configCompact
  const look: Look = {
    ui: $.ui.resolve(e),
    columns: e.props.bodyColumns,
    compact: compact === 'on',
    icons: icons === 'icons',
    today: await $.clock.now(),
    filter: await read($, filterShown),
    labels: await read($, labelFilter),
    unblocks: m.kind === 'ok' ? m.unblocks : {},
    dueBy: m.kind === 'ok' ? m.dueBy : {},
  }
  const built = await builtManifest($)
  const acts: Acts = {
    refresh: () => counted($, 'Refresh', () => refresh($)),
    showHelp: () => showHelp($, id),
    leaveHelp: () => leaveHelp($, id),
    setFilter: (filter, label) => setFilter($, filter, label),
    setLabelFilter: (change, label) => setLabelFilter($, change, label),
    openIssue: (pane, n) => openIssue($, pane, n),
    followIssue: n => followIssue($, id, n),
    goBack: () => goBack($, id),
    foldIssue: n => foldIssue($, n),
    foldMilestone: title => foldMilestone($, title),
    openMilestone: title => openMilestone($, title),
    closeMilestone: (ms, closed) => closeMilestone($, ms, closed),
    assignMe: (i, on) => assignMe($, id, i, on),
    writeIssue: (n, change, what) => writeIssue($, id, n, change, what),
    toggleLabels: () => toggleLabels($, id),
    setLabel: (i, l, on) => setLabel($, id, i, l, on),
    toggleMilestones: () => toggleMilestones($, id),
    setMilestone: (i, m, children) => setMilestone($, id, i, m, children),
    toggleChildrenToo: () => toggleChildrenToo($),
    toggleParents: (i, children) => toggleParents($, id, i, children),
    setParent: (i, p, on, parents) => setParent($, id, i, p, on, parents),
    workOn: i => workOn($, i, { pane: id, issue: i }),
    openUrl: url => openUrl($, url),
    counted: (label, action) => counted($, label, action),
    chooseIcons: value => chooseSetting($, { field: 'icons', value }),
    chooseCompact: value => chooseSetting($, { field: 'compact', value }),
    go: change => go($, id, change),
    setFilterOpen: change => update($, filterOpen, change),
    foldIssues: () => update($, issuesFolded, x => !x),
    setDescription: change => update($, descriptionUnfolded, change),
    toggleClosed: () => update($, closedShown, o => !o),
  }
  const p: Pane = {
    e,
    id,
    place: await placeOf($, id),
    // The pane's full height, so the last rows sit at its bottom.
    height: e.props.scroll.bodyRows,
    look,
    draw: draw(look),
    known,
    shown: await shownState($, e),
    // The tracker behind the repo, for its name and where it makes tokens.
    tracker: r ? tracker($, r) : null,
    acts,
    version: built.version,
    repository: built.repository,
    requests: configDebug ? await read($, requests) : null,
    repoName: r ? slug(r) : '',
  }
  const f = await frame(p)
  const open = issueOf(p.place)
  if (p.place.help) return helpView(p, f)
  if (s.kind === 'ready' && r && icons === 'ask') return iconsChoice(p, f)
  if (s.kind === 'ready' && r && compact === 'ask') return compactChoice(p, f)
  if (s.kind === 'ready' && r && open !== null) return issueView(p, f, r, open)
  if (id === MILESTONES_PANE && s.kind === 'ready' && r) return milestonesView(p, f, s, r)
  if (id === ISSUES_PANE && s.kind === 'ready' && r) return issuesView(p, f, r)
  if (s.kind === 'ready' && r && m.kind !== 'idle' && m.kind !== 'error') return nextView(p, f, m, r)
  return setupView(p, f, configure)
}

// /next opens the panes with What's next in front; /next help opens What's
// next on the help page. `name`: the command as registered.
async function runNext($: EngineInterface, name: string, word: string) {
  const lower = word.toLowerCase()
  const want = lower === '' ? 'both' : lower === 'help' ? 'help' : null
  if (!want) {
    return { text: `/${name} does not know "${word}". Try /${name}, or /${name} help.` }
  }
  const openNext = async (title: string) => {
    await $.ui.open({ id: PANE, title })
    await update($, panesOpen, ids => (ids.includes(PANE) ? ids : [...ids, PANE]))
  }
  // The milestone filter starts where you work again, and the label filter
  // on no labels: a choice holds until /next.
  await update($, filterChosen, () => null)
  await update($, labelFilter, (): LabelFilter => NO_LABELS)
  // The load opens no pane of its own: the Issues and Milestones tabs come
  // below, after What's next.
  await openNext("What's Next")
  const r = await refresh($, false)
  const s = await read($, setup)
  const shown = await read($, issues)
  const hasIssues = shown.kind === 'ok' && shown.openIssues > 0
  if (r) await openNext("What's next")
  // The Issues pane, a tab next to What's next, only while there are open
  // issues (#99, decided 4).
  if (hasIssues) {
    await $.ui.open({ id: ISSUES_PANE, title: 'Issues' })
    await update($, panesOpen, ids => (ids.includes(ISSUES_PANE) ? ids : [...ids, ISSUES_PANE]))
  } else if (shown.kind === 'ok' && (await read($, panesOpen)).includes(ISSUES_PANE)) {
    await $.ui.close({ id: ISSUES_PANE })
  }
  // The Milestones pane, a tab after Issues, only while there are open
  // milestones; one the person closed opens again.
  const ms = await read($, milestones)
  const open = await read($, panesOpen)
  if (r && s.kind === 'ready' && ms !== null && ms.length > 0 && !open.includes(MILESTONES_PANE)) {
    await $.ui.open({ id: MILESTONES_PANE, title: 'Milestones' })
    await update($, panesOpen, ids => (ids.includes(MILESTONES_PANE) ? ids : [...ids, MILESTONES_PANE]))
  } else if (ms !== null && ms.length === 0 && open.includes(MILESTONES_PANE)) {
    await $.ui.close({ id: MILESTONES_PANE })
  }
  // A pane opened new comes in front of the rest, and only `focus` brings an
  // open one back: What's next last, with the keyboard.
  await $.ui.open({ id: PANE, title: r ? "What's next" : "What's Next", focus: true })
  if (want === 'help') {
    await showHelp($, PANE)
    return { text: "What's Next's help is open in What's next: what each sign and colour means." }
  }
  const o = await read($, overview)
  if (s.kind !== 'ready' || !r) return { text: "What's Next needs setting up: see its pane." }
  const shownFilter = await read($, filterShown)
  // The filter's word in a sentence.
  const showing = shownFilter ? filterWord(shownFilter.set) : 'All'
  if (o.kind !== 'ok') return { text: `What's Next is ready for ${slug(r)}, but could not load its issues.` }
  if (o.inProgress.length + o.queue.length + o.blocked.length === 0 && !o.next) {
    return { text: `What's Next is ready for ${slug(r)}: no open issues.` }
  }
  const scope = o.next ? o.scopes[o.next.number] : undefined
  const where =
    scope?.kind === 'due' ? ', due soon' : scope?.kind === 'epic' ? `, in epic #${scope.number}` : scope?.kind === 'milestone' ? `, in ${scope.title}` : ''
  const then = o.next ? `next is #${o.next.number}${where}` : o.blocked.length > 0 ? 'nothing available' : 'nothing else open'
  const filter = shownFilter && shownFilter.set.kind !== 'all' ? ` (${showing})` : ''
  return { text: `What's Next is ready for ${slug(r)}: ${o.inProgress.length} in progress, ${then}${filter}.` }
}

export const register: Register = (on, options) => {
  configTokens['Forgejo tokens'] = String(options.token ?? '').trim()
  configTokens['GitLab.com token'] = String(options.gitlabComToken ?? '').trim()
  configTokens['Private GitLab token'] = String(options.gitlabTokens ?? '').trim()
  configTokens['GitHub token'] = String(options.githubTokens ?? '').trim()
  configIcons = String(options.icons ?? 'ask')
  configCompact = String(options.compact ?? 'ask')
  configLabel = String(options.label ?? 'epic').trim() || 'epic'
  configDebug = options.debug === true

  on('session.start', async ($, e, next) => {
    // Which marketplace What's Next came from, for the command that sets a token.
    configure = configureCommand(((await $.config.list().catch(() => [])) ?? []).map(r => r.key))
    // /next, unless another plugin, the person or an MCP server has it:
    // then /whats-next. A `next` whose plugin the engine does not name
    // cannot be told from another's, so it counts as taken.
    const commands = await $.command.list().catch(() => [])
    const taken = commands.some(c => c.name === COMMAND && !(c.source === 'plugin' && c.plugin !== undefined && /^whats-next(@|$)/.test(c.plugin)))
    await $.command.register({
      name: taken ? FALLBACK_COMMAND : COMMAND,
      description: "Your issues and what's next, for this repo",
      argumentHint: '[help]',
    })
    if (taken) $.ui.toast("/next is taken by another command: What's Next is /whats-next in this session.")
    // A reload brings new code but keeps the session's state, which the old
    // code wrote. With What's Next's panes open, load once, so they show what this
    // code would.
    if ((await read($, panesOpen)).length > 0) await counted($, 'reload', () => refresh($))
    return next(e)
  })

  // A /clear starts the session's state over, What's Next's list of open
  // panes too, and fires no session.start; the panes themselves stay up. With
  // one of them up, take the list from the engine's record and load again.
  on('classic.SessionStart', async ($, e, next) => {
    const done = await next(e)
    if (e.source !== 'clear') return done
    const ours = (await $.ui.panes().catch(() => [])).map(p => p.id).filter(id => id === PANE || id === ISSUES_PANE || id === MILESTONES_PANE)
    if (ours.length > 0) {
      await update($, panesOpen, () => ours)
      await counted($, 'clear', () => refresh($))
    }
    return done
  })

  // Both names: only the one registered reaches here.
  for (const command of [COMMAND, FALLBACK_COMMAND]) {
    on('command.run', { command }, async ($, e) => {
      const word = e.args.trim()
      return counted($, word ? `/${command} ${word}` : `/${command}`, () => runNext($, command, word))
    })
  }

  on('config.set', settingChanged)
  on('ui.close', { id: PANE }, paneClosed)
  on('ui.close', { id: ISSUES_PANE }, paneClosed)
  on('ui.close', { id: MILESTONES_PANE }, paneClosed)
  for (const requestId of [PANE, ISSUES_PANE, MILESTONES_PANE]) {
    on('ui.scroll', { requestId }, scrollDetail)
    on('ui.focus', { requestId }, focusMoved)
  }
  on('ui.render', { component: 'Pane', requestId: PANE }, renderPane)
  on('ui.render', { component: 'Pane', requestId: ISSUES_PANE }, renderPane)
  on('ui.render', { component: 'Pane', requestId: MILESTONES_PANE }, renderPane)
}
