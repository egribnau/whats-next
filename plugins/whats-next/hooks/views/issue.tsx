import { atom, memberOf, read } from 'claude-code'
import type { EngineInterface, RenderChildren } from 'claude-code'

import type { Comment, DetailFolds, IssueDetail, Label, Milestone, ParentChoices, Ref, Repo, RepoLabels } from '../../types'
import { age, CLOSED_MARK, fit, FOLD_AT, ICON, whoOf } from '../draw'
import { dueFirst, isMine, markOf, standing, type Mark, type Standing } from '../epics'
import { duration, wrap } from '../issue'
import { slug } from '../tracker'
import * as step from '../where'
import { foldsOf } from '../where'
import { go } from '../panes'
import { listShown, type Action, type Frame, type Pane } from './frame'

// The state this view reads (the contract in types/index.d.ts).
const setup = atom({ plugin: 'whats-next', key: 'setup' } as const, { kind: 'checking' })
const detail = atom({ plugin: 'whats-next', key: 'detail' } as const, { kind: 'idle' })
const repoLabels = atom({ plugin: 'whats-next', key: 'repoLabels' } as const, { kind: 'idle' })
const milestones = atom({ plugin: 'whats-next', key: 'milestones' } as const, null)
const childrenToo = atom({ plugin: 'whats-next', key: 'childrenToo' } as const, true)
const parentChoices = atom({ plugin: 'whats-next', key: 'parentChoices' } as const, { kind: 'idle' })
const spinner = atom({ plugin: 'whats-next', key: 'spinner' } as const, 0)

// The spinner's frames, one cell each (DRAWING-issue.md, The labels list).
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// The issue detail (DRAWING-issue.md), in place of the list: issue `open`
// of repo `r`, as read from the forge.
export async function issueView($: EngineInterface, p: Pane, f: Frame, r: Repo, open: number) {
  const { id, draw: d, acts, known } = p
  const { Box, Text, Button } = p.look.ui
  const { columns } = p.look
  const t = p.tracker
  const s = await read($, setup)
  const dt = await read($, memberOf(detail, p.e))
  const now = p.look.today
  const folds = foldsOf(p.place)
  const setFolds = (change: (x: DetailFolds) => DetailFolds) => () => go($, id, w => step.fold(w, change))
  const body: RenderChildren[] = []
  const gapRow = (key: string) => <Box key={key} height={1} flexShrink={0} />
  // Lines of text that may run long, each cut to the pane: a detail counts its rows.
  const lines = (key: string, text: string, props: Record<string, unknown> = {}) =>
    wrap(text, columns).map((tl, k) => d.line(`${key}-${k}`, tl || ' ', props))
  let actions: Action[] = [f.refreshAction, f.helpAction]
  let note: string | undefined
  let prompt: RenderChildren = null
  if (dt.kind === 'loading' || dt.kind === 'idle') body.push(d.line('loading', `Loading #${open}…`, { dimColor: true }))
  if (dt.kind === 'error') body.push(...lines('error', `Could not load #${dt.number}: ${dt.message}.`, { color: 'error' }))
  let over: RenderChildren = null
  let shownLabels: { issue: IssueDetail; known: RepoLabels; scroll: number } | null = null
  let shownMilestones: { issue: IssueDetail; open: Milestone[] | null; scroll: number; kids: number[]; too: boolean } | null = null
  let shownParents: { issue: IssueDetail; choices: ParentChoices; scroll: number; under: Ref[] } | null = null
  // The epic list's word: on GitHub any issue can be a parent (DRAWING-issue.md, The epic list).
  const word = t?.nested ? 'Parent' : 'Epic'
  // A list waiting on the forge, and its spinner's frame (DRAWING-issue.md, The labels list).
  const waiting = dt.kind === 'ok' ? dt.busy : undefined
  const frame = SPIN[(await read($, spinner)) % SPIN.length] ?? ' '
  listShown.delete(id)
  if (dt.kind === 'ok') {
    const i = dt.issue
    // Assign, close, labels, milestone and epic, when What's Next may:
    // setup's Actions step says so.
    const allowed = s.kind === 'ready' ? s.actions : ({ kind: 'read-only', reason: 'scope' } as const)
    const canAct = allowed.kind !== 'read-only'
    // Every key of the detail in one gutter, as wide as the longest, Blocked by.
    const KEY = 11
    const keyed = (key: string, label: string, content: RenderChildren) => (
      <Box key={key} height={1} flexShrink={0}>
        <Text dimColor>{label.padEnd(KEY)}</Text>
        {content}
      </Box>
    )
    // The issues it is a child of, and what it blocks but those epics.
    const parents = dt.parents ?? []
    const blocks = (i.blocks ?? []).filter(x => !parents.some(q => q.epic && q.number === x.number))
    // Its children, the open ones a line each, the closed ones counted; what
    // blocks it is then only what it waits on outside them: on Forgejo an
    // epic depends on each child (DRAWING-issue.md, Detail lines that name
    // an issue).
    const children = dt.children ?? []
    const childNumbers = children.map(x => x.number)
    const openChildren = children.filter(x => x.state !== 'closed')
    const closedChildren = children.length - openChildren.length
    const blockedBy = (i.blockedBy ?? []).filter(x => !children.some(c => c.number === x.number))
    // Pull requests under the forge's word, and on GitLab its sign: !61 there is a merge request, #61 an issue.
    const gitlab = t?.name === 'GitLab'
    // One issue or pull request on a line: mark, number, title. An issue's
    // mark as the lists draw it, closed a grey ✓; a pull request has none
    // but ✓. Numbers sit at the right of one column, so titles start in one
    // column; at the right whom it is with, or merged. No state word: the
    // mark says it (DRAWING-issue.md, Detail lines that name an issue). All
    // but pull request lines are buttons that open their issue here.
    type RefKind = 'parent' | 'child' | 'blocker' | 'blocks' | 'pull'
    const numberOf = (x: Ref, kind: RefKind) => `${kind === 'pull' && gitlab ? '!' : '#'}${x.number}`
    const refs: [Ref, RefKind][] = [
      ...parents.map((x): [Ref, RefKind] => [x, 'parent']),
      ...openChildren.map((x): [Ref, RefKind] => [x, 'child']),
      ...blockedBy.map((x): [Ref, RefKind] => [x, 'blocker']),
      ...blocks.map((x): [Ref, RefKind] => [x, 'blocks']),
      ...(i.pulls ?? []).map((x): [Ref, RefKind] => [x, 'pull']),
    ]
    const login = known?.me ?? null
    const refStanding = (x: Ref, kind: RefKind): Standing | null =>
      kind === 'pull' || x.state !== 'open'
        ? null
        : standing({ mine: isMine(x.assignees ?? [], login), blocked: x.blocked === true, assignees: x.assignees ?? [] })
    const endOf = (x: Ref, kind: RefKind) => {
      const st = refStanding(x, kind)
      return kind === 'pull' ? (x.state === 'merged' ? 'merged' : '') : st ? whoOf({ assignees: x.assignees ?? [] }, st) : ''
    }
    const refNum = Math.max(0, ...refs.map(([x, kind]) => numberOf(x, kind).length))
    const refEnd = Math.max(0, ...refs.map(([x, kind]) => endOf(x, kind).length))
    // A parent line ends in → (DRAWING-issue.md, Detail lines that name an issue).
    const arrow = parents.length > 0 ? 2 : 0
    const refLine = (key: string, label: string, x: Ref, kind: RefKind) => {
      const done = x.state === 'closed'
      const st = refStanding(x, kind)
      const mark: Mark = done ? CLOSED_MARK : st ? markOf(st, null) : { glyph: ' ' }
      const end = endOf(x, kind)
      const room = columns - KEY - 2 - refNum - 1 - (refEnd > 0 ? refEnd + 1 : 0) - arrow
      const row = (
        <Text wrap="truncate-end">
          {d.markText(mark)}
          <Text color={done ? 'inactive' : 'suggestion'}>{numberOf(x, kind).padStart(refNum)}</Text>
          <Text color={done ? 'inactive' : undefined} dimColor={st === 'blocked'}>{` ${fit(x.title, room).padEnd(room)}`}</Text>
          {refEnd > 0 ? (
            <Text color={x.state === 'merged' ? 'merged' : undefined} dimColor={x.state !== 'merged'}>
              {` ${end.padStart(refEnd)}`}
            </Text>
          ) : null}
        </Text>
      )
      // A parent line opens the epic list where the token may write, and is
      // plain text where it may not; its → opens the parent either way.
      if (kind === 'parent') {
        return keyed(
          key,
          label,
          <>
            {canAct ? (
              <Button key={`${key}-line`} plain onPress={() => acts.toggleParents(i, childNumbers)}>
                {row}
              </Button>
            ) : (
              row
            )}
            <Text> </Text>
            <Button key={`follow-${x.number}`} plain onPress={() => acts.followIssue(x.number)}>
              <Text>→</Text>
            </Button>
          </>,
        )
      }
      return keyed(
        key,
        label,
        kind === 'pull' ? (
          row
        ) : (
          <Button key={`follow-${x.number}`} plain onPress={() => acts.followIssue(x.number)}>
            {row}
          </Button>
        ),
      )
    }
    // Whether it can have a parent: on Forgejo and GitLab an epic has none.
    const ownEpic = p.known?.openEpics.has(i.number) ?? false
    const canParent = canAct && (t?.nested === true || !ownEpic)
    // The facts, in the facts line's order, then what only the detail has
    // (DRAWING-issue.md, Detail lines that name an issue).
    const facts: RenderChildren[] = []
    parents.forEach((x, k) => facts.push(refLine(`parent-${k}`, k === 0 ? (x.epic ? 'Epic' : 'Parent') : '', x, 'parent')))
    // With none, where the token may write, a line to open the epic list from.
    if (parents.length === 0 && canParent) {
      facts.push(
        keyed(
          'parent-0',
          word,
          <Button key="parent-0-line" plain onPress={() => acts.toggleParents(i, childNumbers)}>
            <Text dimColor>none</Text>
          </Button>,
        ),
      )
    }
    openChildren.forEach((x, k) => facts.push(refLine(`child-${k}`, k === 0 ? 'Children' : '', x, 'child')))
    if (closedChildren > 0) {
      facts.push(keyed('children-closed', openChildren.length === 0 ? 'Children' : '', <Text color="inactive">{`✓ ${closedChildren} closed`}</Text>))
    }
    blockedBy.forEach((x, k) => facts.push(refLine(`blocked-${k}`, k === 0 ? 'Blocked by' : '', x, 'blocker')))
    blocks.forEach((x, k) => facts.push(refLine(`blocks-${k}`, k === 0 ? 'Blocks' : '', x, 'blocks')))
    if (i.due) facts.push(keyed('due', 'Due', d.dueDate('due-date', i.due, now, { form: 'long', bare: true })))
    // Where the token may change it, the Milestone line opens the milestone
    // list, and stays with none (DRAWING-issue.md, The milestone list).
    const milestoneValue = i.milestone ? (
      d.partsLine('milestone-parts', 0, [{ text: i.milestone.title }, ...d.duePart('milestone-due', i.milestone.due, now, { form: 'short' })])
    ) : (
      <Text dimColor>none</Text>
    )
    // Waiting on the forge, its spinner before the value.
    const milestoneText =
      waiting?.list === 'milestones' ? (
        <Text>
          <Text dimColor>{`${frame} `}</Text>
          {milestoneValue}
        </Text>
      ) : (
        milestoneValue
      )
    if (canAct) {
      facts.push(
        keyed(
          'milestone',
          'Milestone',
          <Button key="milestone-line" plain onPress={acts.toggleMilestones}>
            {milestoneText}
          </Button>,
        ),
      )
    } else if (i.milestone) facts.push(keyed('milestone', 'Milestone', milestoneText))
    // The labels in rows that fit after the key, a label never split (one
    // longer than the row is cut): in a button the text wraps instead, and
    // squeezes the key (DRAWING-issue.md, Detail lines; #74, decided 10b).
    const labelRows: Label[][] = []
    for (const l of i.labels) {
      const row = labelRows[labelRows.length - 1]
      const used = row ? row.reduce((n, x) => n + x.name.length + 2, 0) : 0
      // Room for the name, and for the comma after it should one follow.
      if (row && used + l.name.length + 1 <= columns - KEY) row.push(l)
      else labelRows.push([{ ...l, name: fit(l.name, columns - KEY - 1) }])
    }
    const labelsRow = (row: Label[], k: number) => (
      <Text>
        {d.labelTexts(row)}
        {k < labelRows.length - 1 && <Text dimColor>,</Text>}
      </Text>
    )
    // Where the token may change them, the Labels lines open the labels
    // list, and stay with none (DRAWING-issue.md, The labels list).
    if (canAct) {
      if (labelRows.length === 0) {
        facts.push(
          keyed(
            'labels',
            'Labels',
            <Button key="labels-line" plain onPress={acts.toggleLabels}>
              <Text dimColor>none</Text>
            </Button>,
          ),
        )
      }
      labelRows.forEach((row, k) =>
        facts.push(
          keyed(
            k === 0 ? 'labels' : `labels-${k}`,
            k === 0 ? 'Labels' : '',
            <Button key={k === 0 ? 'labels-line' : `labels-line-${k}`} plain onPress={acts.toggleLabels}>
              {labelsRow(row, k)}
            </Button>,
          ),
        ),
      )
    } else labelRows.forEach((row, k) => facts.push(keyed(k === 0 ? 'labels' : `labels-${k}`, k === 0 ? 'Labels' : '', labelsRow(row, k))))
    if (i.branch) facts.push(keyed('branch', 'Branch', <Text>{i.branch}</Text>))
    const time = i.logged
      ? `${duration(i.logged)} logged${i.estimate ? ` of ${duration(i.estimate)} estimated` : ''}`
      : i.estimate
        ? `${duration(i.estimate)} estimated`
        : null
    if (time) facts.push(keyed('time', 'Time', <Text>{time}</Text>))
    ;(i.pulls ?? []).forEach((x, k) => facts.push(refLine(`pull-${k}`, k === 0 ? (gitlab ? 'MRs' : 'PRs') : '', x, 'pull')))
    // One text, as a line naming an issue: sha dim, message padded to its
    // room, age dim at the right. Pieces side by side were squeezed out.
    ;(i.commits ?? []).slice(0, 3).forEach((c, k) => {
      const ago = ` ${age(c.when, now)} ago`
      const room = Math.max(0, columns - KEY - c.sha.length - 1 - ago.length)
      facts.push(
        keyed(
          `commit-${k}`,
          k === 0 ? 'Commits' : '',
          <Text wrap="truncate-end">
            <Text dimColor>{`${c.sha} `}</Text>
            {fit(c.message, room).padEnd(room)}
            <Text dimColor>{ago}</Text>
          </Text>,
        ),
      )
    })

    const me = known?.me ?? null
    const mine = isMine(i.assignees, me)
    const closed = i.state === 'closed'
    // Its mark before the number, as the lists draw it; closed a grey ✓.
    // Whom it is with at the right of the first line, dim.
    const ownStanding = closed ? null : standing({ mine, blocked: dt.blocked === true, assignees: i.assignees })
    const ownMark: Mark = ownStanding ? markOf(ownStanding, null) : CLOSED_MARK
    const who = ownStanding ? whoOf({ assignees: i.assignees }, ownStanding) : ''
    // The heading wraps over two lines at most, under the number; a longer
    // title ends the second in ….
    const headText = `#${i.number} ${i.title}`
    const headWidth = columns - 2 - (who ? who.length + 1 : 0)
    const wrapped = wrap(headText, headWidth)
    const titleLines =
      wrapped.length > 2 ? [wrapped[0] ?? '', fit(headText.slice((wrapped[0] ?? '').length).trimStart(), headWidth)] : wrapped
    actions = [
      ...(canAct
        ? [
            {
              key: 'assign',
              label: mine ? 'Unassign Me' : 'Assign Me',
              hotkey: 'a',
              onPress: () => acts.counted(`${mine ? 'unassign' : 'assign'} #${i.number}`, () => acts.assignMe(i, !mine)),
            },
            {
              key: 'close',
              label: closed ? 'Reopen' : 'Close',
              hotkey: 'c',
              onPress: () =>
                acts.counted(`${closed ? 'reopen' : 'close'} #${i.number}`, () =>
                  acts.writeIssue(i.number, tr => tr.close(i.number, !closed), closed ? 'reopen' : 'close'),
                ),
            },
            { key: 'labels', label: 'Labels', hotkey: 'l', onPress: acts.toggleLabels },
            { key: 'milestone', label: 'Milestone', hotkey: 'm', onPress: acts.toggleMilestones },
            ...(canParent ? [{ key: 'parents', label: word, hotkey: 'e', onPress: () => acts.toggleParents(i, childNumbers) }] : []),
          ]
        : []),
      { key: 'open', label: 'Open in Browser', hotkey: 'o', onPress: () => acts.openUrl(i.url) },
      f.refreshAction,
      f.helpAction,
    ]
    note = canAct
      ? undefined
      : allowed.kind === 'read-only' && allowed.reason === 'role'
        ? `Assign, close, labels, milestone and epic need Reporter or higher on ${slug(r)}.`
        : allowed.kind === 'read-only' && allowed.reason === 'push'
          ? `Assign, close, labels, milestone and epic need push rights on ${slug(r)}.`
          : `Assign, close, labels, milestone and epic need a token with ${t?.writeScope ?? 'write:issue'}: the setup guide's steps make one.`
    if (canAct && p.place.labels) shownLabels = { issue: i, known: await read($, repoLabels), scroll: p.place.labels.scroll }
    // The open children in its milestone, which Children too moves with it.
    const kids = children.filter(x => x.state === 'open' && (x.milestone ?? null) === (i.milestone?.title ?? null)).map(x => x.number)
    if (canAct && p.place.milestones) {
      shownMilestones = { issue: i, open: await read($, milestones), scroll: p.place.milestones.scroll, kids, too: await read($, childrenToo) }
    }
    if (canParent && p.place.parents) {
      shownParents = { issue: i, choices: await read($, memberOf(parentChoices, p.e)), scroll: p.place.parents.scroll, under: parents }
    }
    prompt = <Button key="prompt" label={d.say(ICON.work, 'Prompt')} hotkey="p" onPress={() => acts.workOn(i)} />

    // Closed: grey as a whole, number and title; blocked: the title dim.
    // Under it who opened it when (DRAWING-issue.md, The issue detail's
    // heading). No state word: the mark says it.
    titleLines.forEach((tl, k) =>
      body.push(
        <Text key={`t-${k}`} bold wrap="truncate-end" color={closed ? 'inactive' : undefined}>
          {k === 0 ? d.markText(ownMark) : '  '}
          {k === 0 && !closed ? <Text color="suggestion">{`#${i.number}`}</Text> : null}
          <Text dimColor={ownStanding === 'blocked'}>{k === 0 && !closed ? tl.slice(`#${i.number}`.length) : tl}</Text>
          {k === 0 && who ? <Text dimColor bold={false}>{`${' '.repeat(Math.max(1, headWidth - tl.length + 1))}${who}`}</Text> : null}
        </Text>,
      ),
    )
    body.push(d.partsLine('opened', 2, [{ text: `✎ ${age(i.created, now)} ${i.author}` }]))
    if (dt.error) body.push(gapRow('gap-error'), ...lines('action-error', dt.error, { color: 'error' }))
    if (facts.length > 0) body.push(gapRow('gap-facts'), ...facts)

    // Description folds from 5 lines on (FOLD_AT): folded, its first 3 and
    // how many more.
    const descLines = i.body.trim() === '' ? [] : wrap(i.body.trim(), columns)
    const descShown = folds.description || descLines.length <= FOLD_AT ? descLines.length : 3
    body.push(
      gapRow('gap-desc'),
      descLines.length > FOLD_AT
        ? d.rule('description-rule', 'Description', [], { key: 'description-section', open: folds.description, onPress: setFolds(x => ({ ...x, description: !x.description })) })
        : d.rule('desc', 'Description'),
    )
    if (descLines.length === 0) body.push(d.line('no-desc', 'No description.', { dimColor: true }))
    descLines.slice(0, descShown).forEach((tl, k) => body.push(d.line(`d-${k}`, tl || ' ')))
    if (descShown < descLines.length) body.push(d.moreLine('description-more', descLines.length - descShown, setFolds(x => ({ ...x, description: true }))))

    // Comments, newest first: the newest unfolded, each older one a dim
    // line that unfolds it (DRAWING-issue.md, The issue detail's comments).
    const said = i.commentList
    const count = said ? said.length : i.comments
    if (count > 0) {
      body.push(
        gapRow('gap-comments'),
        d.rule('comments-rule', 'Comments', [{ text: `${count}` }], { key: 'comments-section', open: !folds.commentsShut, onPress: setFolds(x => ({ ...x, commentsShut: !x.commentsShut })) }),
      )
    }
    if (count > 0 && !folds.commentsShut && !said) body.push(d.line('comments-unknown', 'comments unknown', { dimColor: true }))
    if (count > 0 && !folds.commentsShut && said) {
      const newest = [...said].reverse()
      const idOf = (c: Comment) => `${c.when} ${c.author}`
      const first = newest[0] ? [idOf(newest[0])] : []
      const unfoldedOnes = new Set(folds.comments ?? first)
      const fold = (cid: string, on: boolean) =>
        setFolds(x => {
          const was = (x.comments ?? first).filter(y => y !== cid)
          return { ...x, comments: on ? [...was, cid] : was }
        })
      newest.forEach((c, k) => {
        const cid = idOf(c)
        const ago = `${age(c.when, now)} ago`
        const author = fit(c.author, columns - 2)
        if (unfoldedOnes.has(cid)) {
          body.push(
            <Box key={`comment-row-${k}`} height={1} flexShrink={0}>
              <Button key={`comment-${k}`} plain onPress={fold(cid, false)}>
                <Text>
                  {'− '}
                  <Text bold>{author}</Text>
                  <Text dimColor>{fit(` · ${ago}`, columns - 2 - author.length)}</Text>
                </Text>
              </Button>
            </Box>,
          )
          // Its first 3 lines, and how many more: pressed, the rest.
          const text = wrap(c.body.trim(), columns)
          const whole = folds.whole.includes(cid) || text.length <= FOLD_AT
          text.slice(0, whole ? text.length : 3).forEach((tl, j) => body.push(d.line(`comment-${k}-${j}`, tl || ' ')))
          if (!whole) body.push(d.moreLine(`comment-more-${k}`, text.length - 3, setFolds(x => ({ ...x, whole: [...x.whole, cid] }))))
          return
        }
        const head = `+ ${author} · ${ago} · `
        const words = fit(c.body.replace(/\s+/g, ' ').trim(), columns - head.length)
        body.push(
          <Box key={`comment-row-${k}`} height={1} flexShrink={0}>
            <Button key={`comment-${k}`} plain onPress={fold(cid, true)}>
              <Text>
                <Text dimColor>{'+ '}</Text>
                <Text bold>{author}</Text>
                <Text dimColor>{fit(` · ${ago} · ${words}`, columns - 2 - author.length)}</Text>
              </Text>
            </Button>
          </Box>,
        )
      })
    }
  }
  // [ ← ] and the menu, with Prompt before it once the issue is read; the
  // labels list, the milestone list or the epic list over the rows when one
  // is open, else the menu.
  const top = f.detailTop(actions, acts.goBack, prompt)
  if (shownLabels) {
    // Its frame on the Labels line's row, else under the top row.
    const at = f.rowOf(top, body, 'labels-line')
    over = labelsList(shownLabels.issue, shownLabels.known, shownLabels.scroll, at ?? 1)
  }
  if (shownMilestones) {
    const at = f.rowOf(top, body, 'milestone-line')
    const sm = shownMilestones
    over = milestoneList(sm.issue, sm.open, sm.scroll, at ?? 1, sm.kids, sm.too)
  }
  if (shownParents) {
    // Its frame on the first Epic line's row.
    const at = f.rowOf(top, body, 'parent-0-line')
    const sp = shownParents
    over = epicList(sp.issue, sp.choices, sp.scroll, at ?? 1, sp.under)
  }
  return f.detailFrame(top, body, over ?? f.menuLines(actions, note))

  // The pane row a list of `lines` lines starts on: `want` where it fits
  // below there; where it does not, as far up as it must, to under the top
  // row at most.
  function startAt(want: number, lines: number) {
    const counted = p.requests ? 1 : 0
    return Math.max(1, Math.min(want, p.height - counted - lines - 3))
  }

  // A list's first line: its name at the left, dim, the spinner in the
  // middle while it waits (`spin`), in the gap after the name where the name
  // reaches the middle, and ✕ at the right, button `shut`, which shuts it; it
  // stays when the lines under it scroll.
  function listHead(name: string, shut: string, width: number, onPress: () => unknown, spin = false) {
    const text = fit(name, width - 2).padEnd(width - 1)
    const named = text.trimEnd().length
    const mid = Math.floor(width / 2) > named ? Math.floor(width / 2) : named + Math.floor((width - 1 - named) / 2)
    return (
      <Box key={`${shut}-head`} height={1} flexShrink={0}>
        <Text dimColor>{spin && mid > named && mid < width - 1 ? text.slice(0, mid) + frame + text.slice(mid + 1) : text}</Text>
        <Button key={shut} plain onPress={onPress}>
          <Text>✕</Text>
        </Button>
      </Box>
    )
  }

  // The labels list (DRAWING-issue.md, The labels list): the repo's labels,
  // each after a box that says whether issue `i` has it; a press adds it or
  // takes it off. Its lines are cut to the pane, scrolled by `scroll`.
  // `want`: the pane row it starts on where it fits below there; where it
  // does not, it moves up as far as it must, to under the top row at most.
  function labelsList(i: IssueDetail, known: RepoLabels, scroll: number, want: number): RenderChildren {
    const said = (key: string, text: string, props: Record<string, unknown>) => [
      <Box key={key} height={1} flexShrink={0}>
        <Text {...props}>{text}</Text>
      </Box>,
    ]
    const busy = waiting?.list === 'labels'
    const head = (width: number) => listHead('Labels', 'labels-shut', width, acts.toggleLabels, busy)
    if (known.kind === 'ok' && known.labels.length > 0) {
      const has = new Set(i.labels.map(l => l.name))
      const width = Math.min(columns - 2, Math.max(10, ...known.labels.map(l => l.name.length + 2)))
      const lines = known.labels.map((l: Label, k) => {
        const on = has.has(l.name)
        const name = fit(l.name, width - 2)
        return (
          <Box key={`label-line-${k}`} height={1} flexShrink={0}>
            <Button
              key={`toggle-label-${k}`}
              plain
              onPress={() => (busy ? undefined : acts.counted(`${on ? 'take off' : 'add'} ${l.name}`, () => acts.setLabel(i, l, !on)))}
            >
              <Text dimColor={busy}>
                {on ? '☑ ' : '☐ '}
                {busy ? name : d.labelTexts([{ name, color: l.color }])}
                {' '.repeat(Math.max(0, width - 2 - name.length))}
              </Text>
            </Button>
          </Box>
        )
      })
      const at = startAt(want, lines.length)
      listShown.set(id, { list: 'labels', lines: lines.length, room: f.overlayRoom(at) - 1, first: 0 })
      return f.overlay('labels-list', width, lines, scroll, head(width), at)
    }
    const text =
      known.kind === 'ok' ? `No labels in ${slug(r)}.` : known.kind === 'error' ? `Could not load the labels: ${known.message}.` : 'Loading …'
    const width = Math.min(columns - 2, Math.max(10, text.length))
    return f.overlay(
      'labels-list',
      width,
      said('labels-said', fit(text, width).padEnd(width), known.kind === 'error' ? { color: 'error' } : { dimColor: true }),
      undefined,
      head(width),
      startAt(want, 1),
    )
  }

  // The milestone list (DRAWING-issue.md, The milestone list): No milestone,
  // then the open milestones `open` in the milestone filter's order, due
  // first; issue `i`'s own in bold, first and grey when it is closed. A
  // press moves the issue there, with `kids` when Children too is ticked
  // (`too`), and shuts the list. Children too and a rule under it lead the
  // list when there are kids. Cut to the pane, scrolled by `scroll`,
  // starting on pane row `want` where it fits.
  function milestoneList(i: IssueDetail, open: Milestone[] | null, scroll: number, want: number, kids: number[], too: boolean): RenderChildren {
    const width = Math.min(columns - 2, 20)
    const head = listHead('Milestone', 'milestones-shut', width, acts.toggleMilestones)
    if (open === null) {
      return f.overlay(
        'milestone-list',
        width,
        [
          <Box key="milestones-said" height={1} flexShrink={0}>
            <Text dimColor>{'Loading …'.padEnd(width)}</Text>
          </Box>,
        ],
        undefined,
        head,
        startAt(want, 1),
      )
    }
    const own = i.milestone?.title ?? null
    const ownClosed = own !== null && !open.some(m => m.title === own)
    type Choice = { title: string; due: string | null; to: Milestone | null; closed?: boolean }
    const choices: Choice[] = [
      { title: 'No milestone', due: null, to: null },
      ...(ownClosed && i.milestone ? [{ title: i.milestone.title, due: i.milestone.due, to: null, closed: true }] : []),
      ...dueFirst(open).map(m => ({ title: m.title, due: m.due, to: m as Milestone })),
    ]
    const lines = choices.map((c, k) => {
      const isOwn = c.closed === true || (c.to ? c.title === own : own === null)
      return (
        <Box key={`milestone-choice-${k}`} height={1} flexShrink={0}>
          <Button
            key={`pick-milestone-${k}`}
            plain
            onPress={() =>
              isOwn
                ? acts.toggleMilestones()
                : acts.counted(c.to ? `move #${i.number} to ${c.title}` : `take #${i.number} out of ${own}`, () => acts.setMilestone(i, c.to, kids))
            }
          >
            <Text bold={isOwn} color={c.closed ? 'inactive' : undefined}>
              {fit(c.title, width - 7).padEnd(width - 6)}
              {d.dueDate('due', c.due, now, { form: 'short', bare: true, width: 6, done: c.closed })}
            </Text>
          </Button>
        </Box>
      )
    })
    const lead: RenderChildren[] = kids.length
      ? [
          <Box key="children-too-line" height={1} flexShrink={0}>
            <Button key="children-too" plain onPress={acts.toggleChildrenToo}>
              <Text>{`${too ? '☑' : '☐'} Children too`.padEnd(width - String(kids.length).length) + String(kids.length)}</Text>
            </Button>
          </Box>,
          <Box key="children-too-rule" height={1} flexShrink={0}>
            <Text dimColor>{'─'.repeat(width)}</Text>
          </Box>,
        ]
      : []
    const all = [...lead, ...lines]
    const at = startAt(want, all.length)
    listShown.set(id, { list: 'milestones', lines: all.length, room: f.overlayRoom(at) - 1, first: lead.length })
    return f.overlay('milestone-list', width, all, scroll, head, at)
  }

  // The epic list (DRAWING-issue.md, The epic list), on GitHub the parent
  // list: No epic, which takes issue `i` out of each of `under`, a parent
  // offered nowhere else, the open epics, and on GitHub under a rule naming
  // its milestone the open issues of it. Each after a box that says whether
  // `i` is under it; a press puts it under or takes it out, and the list
  // stays open. Cut to the pane, scrolled by `scroll`, starting on pane row
  // `want` where it fits.
  function epicList(i: IssueDetail, choices: ParentChoices, scroll: number, want: number, under: Ref[]): RenderChildren {
    const width = Math.min(columns - 2, 40)
    const busy = waiting?.list === 'parents'
    const head = listHead(word, 'parents-shut', width, () => acts.toggleParents(i, []), busy)
    if (choices.kind !== 'ok' || choices.number !== i.number) {
      return f.overlay(
        'parent-list',
        width,
        [
          <Box key="parents-said" height={1} flexShrink={0}>
            <Text dimColor>{'Loading …'.padEnd(width)}</Text>
          </Box>,
        ],
        undefined,
        head,
        startAt(want, 1),
      )
    }
    const ticked = new Set(under.map(x => x.number))
    const offered = new Set([...choices.epics, ...choices.issues].map(x => x.number))
    const login = known?.me ?? null
    const all = [...under.filter(x => !offered.has(x.number)), ...choices.epics, ...choices.issues]
    const num = Math.max(0, ...all.map(x => `#${x.number}`.length))
    const room = width - 2 - 2 - num - 1
    const pick = (x: Ref, row: number) => {
      const on = ticked.has(x.number)
      const st = standing({ mine: isMine(x.assignees ?? [], login), blocked: x.blocked === true, assignees: x.assignees ?? [] })
      return (
        <Box key={`parent-choice-${row}`} height={1} flexShrink={0}>
          <Button
            key={`pick-parent-${row}`}
            plain
            onPress={() =>
              busy ? undefined : acts.counted(`${on ? 'take' : 'put'} #${i.number} ${on ? 'out of' : 'under'} #${x.number}`, () => acts.setParent(i, x.number, !on, [...ticked]))
            }
          >
            {busy ? (
              <Text wrap="truncate-end" dimColor>
                {`${on ? '☑' : '☐'} ${markOf(st, null).glyph} ${`#${x.number}`.padStart(num)} ${fit(x.title, room).padEnd(room)}`}
              </Text>
            ) : (
              <Text wrap="truncate-end">
                {on ? '☑ ' : '☐ '}
                {d.markText(markOf(st, null))}
                <Text color="suggestion">{`#${x.number}`.padStart(num)}</Text>
                <Text dimColor={st === 'blocked'}>{` ${fit(x.title, room).padEnd(room)}`}</Text>
              </Text>
            )}
          </Button>
        </Box>
      )
    }
    const lines: RenderChildren[] = [
      <Box key="parent-choice-0" height={1} flexShrink={0}>
        <Button
          key="pick-parent-0"
          plain
          onPress={() =>
            busy
              ? undefined
              : ticked.size === 0
              ? acts.toggleParents(i, [])
              : acts.counted(`take #${i.number} out of ${[...ticked].map(n => `#${n}`).join(', ')}`, () => acts.setParent(i, null, false, [...ticked]))
          }
        >
          <Text dimColor={busy}>{`No ${word.toLowerCase()}`.padEnd(width)}</Text>
        </Button>
      </Box>,
    ]
    for (const x of [...under.filter(x => !offered.has(x.number)), ...choices.epics]) lines.push(pick(x, lines.length))
    if (choices.issues.length > 0) {
      const name = ` ${i.milestone?.title ?? ''} `
      lines.push(
        <Box key="parent-rule" height={1} flexShrink={0}>
          <Text dimColor>{`────${fit(name, width - 8)}`.padEnd(width, '─')}</Text>
        </Box>,
      )
      for (const x of choices.issues) lines.push(pick(x, lines.length))
    }
    const at = startAt(want, lines.length)
    listShown.set(id, { list: 'parents', lines: lines.length, room: f.overlayRoom(at) - 1, first: 0 })
    return f.overlay('parent-list', width, lines, scroll, head, at)
  }
}
