import { atom, read } from 'claude-code'
import type { EngineInterface, RenderChildren } from 'claude-code'

import type { Child, Epic, Repo } from '../../types'
import { whoOf, type Part } from '../draw'
import { inMilestone, leadsTo, narrowed, openChildren, standing, tree } from '../epics'
import { isAll, leavesOut, matches } from '../filter'
import { slug } from '../tracker'
import { ISSUES_PANE } from '../panes'
import { treeKnown, type Frame, type Pane } from './frame'

// The state this view reads (the contract in types/index.d.ts).
const issues = atom({ plugin: 'whats-next', key: 'issues' } as const, { kind: 'idle' })
const unfolded = atom({ plugin: 'whats-next', key: 'unfolded' } as const, [])

// The Issues pane, once setup passes, for repo `r`: the open issues within
// the milestone filter and the label filter, by milestone, as a milestone
// folded open in Milestones draws them (#99, decided 1): the open epics,
// each folding open to its tree, then the issues no open epic holds, then
// the closed epics.
export async function issuesView($: EngineInterface, p: Pane, f: Frame, r: Repo) {
  const { draw: d, acts } = p
  const { Box } = p.look.ui
  const gap = d.gap
  const now = p.look.today
  const shown = await read($, issues)
  const folds = new Set(await read($, unfolded))
  const set = p.look.labels
  const { kidsOf, openEpics } = await treeKnown($, p)
  const openIssue = (n: number) => acts.openIssue(ISSUES_PANE, n)
  const match = (labels: readonly { name: string }[]) => matches(set, labels)
  const out = (labels: readonly { name: string }[]) => leavesOut(set, labels)
  // Each group as its tree starts, narrowed by the label filter: an open
  // epic stays while it or anything loaded under it is in the filter
  // (#99, decided 2b), an issue or a closed epic while it is.
  const groups = (shown.kind === 'ok' ? shown.groups : []).flatMap(g => {
    const parts = inMilestone(g.issues)
    const own = new Map(parts.epics.map(e => [e.number, e.children]))
    const kids = (n: number) => {
      const loaded = kidsOf(n)
      return loaded !== undefined ? loaded : own.get(n)
    }
    const keeps = (c: { number: number; labels: readonly { name: string }[] }) => leadsTo(c.number, c.labels, kids, match, out)
    const top = parts.epics.filter(keeps).map((e): Epic => ({
      number: e.number,
      title: e.title,
      state: 'open',
      due: e.due,
      children: e.children ?? null,
      labels: e.labels,
      milestone: e.milestone,
      created: e.created,
      blockedBy: e.blockedBy,
    }))
    const plain = openChildren(parts.plain.filter(i => match(i.labels)))
    const closedEpics = parts.closedEpics.filter(e => match(e.labels))
    if (top.length + plain.length + closedEpics.length === 0) return []
    // The tree under each unfolded epic, from what is loaded so far.
    const { lines } = tree(top, kidsOf, folds, openEpics)
    const under = new Map([...lines].map(([n, l]) => [n, narrowed(l, (c: Child) => keeps(c))]))
    return [{ g, top, plain, closedEpics, under }]
  })
  const rows: RenderChildren[] = []
  if (shown.kind === 'loading' || shown.kind === 'idle') rows.push(d.line('loading', 'Loading the issues…', { dimColor: true }))
  if (shown.kind === 'error') rows.push(d.para('error', `Could not load the issues: ${shown.message}.`, { color: 'error' }))
  if (shown.kind === 'ok' && groups.length === 0) {
    rows.push(d.para('none', !isAll(set) ? 'No open issues with these labels.' : `No open issues in ${slug(r)}.`, { dimColor: true }))
  }
  // One number column for every group, so all titles line up.
  const numbers = groups.flatMap(x => [
    ...x.top.flatMap(e => [e.number, ...(x.under.get(e.number) ?? []).flatMap(l => (l.kind === 'child' ? [l.child.number] : []))]),
    ...x.plain.map(i => i.number),
    ...x.closedEpics.map(e => e.number),
  ])
  const numWidth = Math.max(0, ...numbers.map(n => `#${n}`.length)) + 1
  const drawn = new Map<number, number>()
  // An issue drawn twice in the pane needs another address the second time.
  const at = (n: number) => {
    const times = (drawn.get(n) ?? 0) + 1
    drawn.set(n, times)
    return times === 1 ? `${n}` : `${n}@${times}`
  }
  // Whether what was pushed last ends in an empty line: an open epic's row
  // or tree, or an issue's row, does without Compact; a closed epic's row
  // never does.
  let blank = false
  groups.forEach(({ g, top, plain, closedEpics, under }, gi) => {
    // The group's rule: the milestone's name, its due date and how many of
    // its issues are closed.
    const due: Part[] = g.title ? d.duePart('due', g.due, now, { form: 'short' }) : []
    rows.push(
      // After the first, one empty line before it (DRAWING.md, Rules).
      <Box key={`group-${gi}`} flexShrink={0} marginTop={gi > 0 && !blank ? 1 : 0}>
        {d.rule(`group-rule-${gi}`, g.title ?? 'No milestone', g.title ? [...due, { text: `${g.closed}/${g.total} closed` }] : [])}
      </Box>,
    )
    for (const x of top) {
      const key = at(x.number)
      const open = folds.has(x.number)
      blank = !p.look.compact
      rows.push(
        d.epicRow(x, {
          key: `epic-${key}`,
          foldKey: `fold-${key}`,
          openKey: `epic-${key}`,
          lead: 0,
          numWidth,
          open,
          onFold: () => acts.foldIssue(x.number),
          onOpen: () => openIssue(x.number),
        }),
      )
      if (!open) continue
      // Folded open: the tree under it, each level two columns further in.
      const lines = under.get(x.number) ?? []
      const kids = d.tree(lines, { lead: 2, numWidth, button: 'child', drawn, at: key, onOpen: openIssue, onFold: acts.foldIssue })
      // The last child row brings its own empty line; a closing line needs one.
      const endsInRow = lines.at(-1)?.kind === 'child'
      rows.push(
        <Box key={`kids-${key}`} flexDirection="column" flexShrink={0} marginBottom={endsInRow ? 0 : gap}>
          {kids}
        </Box>,
      )
    }
    for (const c of plain) {
      const st = standing(c)
      const key = at(c.number)
      blank = !p.look.compact
      rows.push(
        d.issueRow(c, {
          key: `issue-row-${key}`,
          buttonKey: `issue-${key}`,
          numWidth,
          standing: st,
          who: whoOf(c, st),
          blockedBy: st === 'blocked' ? c.blockedBy : undefined,
          onPress: () => openIssue(c.number),
        }),
      )
    }
    // A closed epic has nothing to fold; its row opens its detail.
    for (const x of closedEpics) {
      const key = at(x.number)
      rows.push(d.closedRow(`epic-${key}`, `epic-${key}`, 2, x.number, numWidth, x.title, () => openIssue(x.number)))
      blank = false
    }
  })
  return f.listFrame(f.titleRow('Issues'), rows, await f.listOverlay())
}
