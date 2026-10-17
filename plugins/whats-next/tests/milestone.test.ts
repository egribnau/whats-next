import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

import { forgejo } from '../hooks/forgejo'
import { github } from '../hooks/github'
import { gitlab } from '../hooks/gitlab'
import type { Send } from '../hooks/tracker'
import type { Repo } from '../types'

// The milestone list (#68, DRAWING-issue.md, The milestone list): an issue
// moved to a milestone and out of one on each forge, then the list in the
// issue detail of the pane.

type Engine = Parameters<TestBody>[0]

// A fake Send that answers every request with `status`, and keeps what was sent.
type Sent = { method: string; url: string; body: unknown }
function fake(status: number, body: unknown = {}) {
  const sent: Sent[] = []
  const send: Send = async (url, init) => {
    sent.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return { status, ok: status >= 200 && status < 300, headers: {}, text: JSON.stringify(body) }
  }
  return { send, sent }
}

const V12 = { title: 'v1.2', due: null, closed: 0, total: 0, id: 12 }

test('Forgejo: moved by the milestone id, taken out with 0', async () => {
  const r: Repo = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const api = 'https://git.example.org/api/v1/repos/boats/radar'
  const { send, sent } = fake(201)
  const t = forgejo(send, r, 'secret', 'epic', '11.0.0')
  expect(await t.milestone(29, V12)).toBeNull()
  expect(await t.milestone(29, null)).toBeNull()
  expect(sent).toEqual([
    { method: 'PATCH', url: `${api}/issues/29`, body: { milestone: 12 } },
    { method: 'PATCH', url: `${api}/issues/29`, body: { milestone: 0 } },
  ])
})

test('Forgejo: a refused move says Forgejo message', async () => {
  const r: Repo = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const { send } = fake(403, { message: 'user should have permission to write issue' })
  const t = forgejo(send, r, 'secret', 'epic', '11.0.0')
  expect(await t.milestone(29, V12)).toBe('user should have permission to write issue')
})

test("GitLab: moved by the milestone id, a parent group's too; taken out with 0", async () => {
  const r: Repo = { host: 'gitlab.com', owner: 'boats', name: 'radar' }
  const project = 'https://gitlab.com/api/v4/projects/boats%2Fradar'
  const { send, sent } = fake(200)
  const t = gitlab(send, r, 'glpat-secret', null)
  expect(await t.milestone(29, V12)).toBeNull()
  expect(await t.milestone(29, { ...V12, id: 40, group: 'boats' })).toBeNull()
  expect(await t.milestone(29, null)).toBeNull()
  expect(sent).toEqual([
    { method: 'PUT', url: `${project}/issues/29`, body: { milestone_id: 12 } },
    { method: 'PUT', url: `${project}/issues/29`, body: { milestone_id: 40 } },
    { method: 'PUT', url: `${project}/issues/29`, body: { milestone_id: 0 } },
  ])
})

test('GitLab: a refused move says GitLab message', async () => {
  const r: Repo = { host: 'gitlab.com', owner: 'boats', name: 'radar' }
  const { send } = fake(403, { message: '403 Forbidden' })
  const t = gitlab(send, r, 'glpat-secret', null)
  expect(await t.milestone(29, V12)).toBe('403 Forbidden')
})

test('GitHub: moved by the milestone number, taken out with null', async () => {
  const r: Repo = { host: 'github.com', owner: 'boats', name: 'radar' }
  const api = 'https://api.github.com/repos/boats/radar'
  const { send, sent } = fake(200)
  const t = github(send, r, 'ghp_secret', null)
  expect(await t.milestone(14, V12)).toBeNull()
  expect(await t.milestone(14, null)).toBeNull()
  expect(sent).toEqual([
    { method: 'PATCH', url: `${api}/issues/14`, body: { milestone: 12 } },
    { method: 'PATCH', url: `${api}/issues/14`, body: { milestone: null } },
  ])
})

test('GitHub: a refused move says GitHub message', async () => {
  const r: Repo = { host: 'github.com', owner: 'boats', name: 'radar' }
  const { send } = fake(403, { message: 'Must have push access' })
  const t = github(send, r, 'ghp_secret', null)
  expect(await t.milestone(14, V12)).toBe('HTTP 403, Must have push access')
})

// The pane, on Forgejo.

const PANE = {
  plugin: 'whats-next',
  component: 'Pane',
  requestId: 'next',
  props: {
    title: "What's Next",
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN = {
  command: 'next',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 170 },
} as const

const TOKEN = { options: { token: 'secret', icons: 'text', compact: 'off' } }
const API = 'https://git.example.org/api/v1/repos/boats/radar'

// The open milestones, not in the order the list shows them: due first.
const MILESTONES = [
  { id: 13, title: 'v2.0', due_on: null, open_issues: 0, closed_issues: 0 },
  { id: 12, title: 'v1.2', due_on: '2026-11-20T00:00:00Z', open_issues: 0, closed_issues: 0 },
  { id: 11, title: 'v1.1', due_on: '2026-10-30T00:00:00Z', open_issues: 1, closed_issues: 0 },
]
const CLOSED = { id: 10, title: 'v1.0', due_on: '2026-09-12T00:00:00Z', open_issues: 0, closed_issues: 3 }

type World = {
  // The issue's milestone by id, changed by what is sent; 0 for none.
  milestone?: number
  // The open milestones, over MILESTONES.
  open?: typeof MILESTONES
  // #29 an epic, its children #31 and #34 open in v1.1, #32 open in v1.2,
  // #33 closed in v1.1.
  epic?: boolean
  // A child whose move is refused.
  refuseChild?: number
  scopes?: string[]
  refuse?: boolean
  // A write held until this settles, to see the pane while it waits.
  hold?: Promise<void>
  sent: Sent[]
}

function world(on: On, w: World) {
  const clock = mock.clock(on)
  let has = w.milestone ?? 11
  const open = w.open ?? MILESTONES
  const raw = () => [...open, CLOSED].find(m => m.id === has) ?? null
  const kids: Record<number, { milestone: number; state: string }> = {
    31: { milestone: 11, state: 'open' },
    32: { milestone: 12, state: 'open' },
    33: { milestone: 11, state: 'closed' },
    34: { milestone: 11, state: 'open' },
  }
  const child = (n: number) => ({
    number: n,
    title: `Child ${n}`,
    state: kids[n]?.state ?? 'open',
    html_url: `https://git.example.org/boats/radar/issues/${n}`,
    body: '',
    user: { login: 'alice' },
    created_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-10-07T12:00:00Z',
    comments: 0,
    milestone: [...open, CLOSED].find(m => m.id === kids[n]?.milestone) ?? null,
    due_date: null,
    labels: [],
    assignees: [],
    repository: { full_name: 'boats/radar' },
  })
  on('process.run', (_$, e) => {
    const cmd = e.argv.join(' ')
    const stdout = cmd === 'git remote get-url origin' ? 'git@git.example.org:boats/radar.git' : 'true'
    return { value: { exitCode: 0, stdout: `${stdout}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('http.fetch', async (_$, e) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const reply = (status: number, body: unknown) => ({
      value: { status, ok: status >= 200 && status < 300, headers: {}, text: JSON.stringify(body) },
    })
    const path = e.url.startsWith(API) ? url.pathname.slice(new URL(API).pathname.length) : null
    const issue = () => ({
      number: 29,
      title: 'Docs: config keys',
      state: 'open',
      html_url: 'https://git.example.org/boats/radar/issues/29',
      body: 'Short.',
      user: { login: 'alice' },
      created_at: '2026-09-18T09:00:00Z',
      updated_at: '2026-10-07T12:00:00Z',
      comments: 0,
      milestone: raw(),
      due_date: null,
      labels: w.epic ? [{ name: 'epic', color: '' }] : [],
      repository: { full_name: 'boats/radar' },
    })
    if (method !== 'GET') {
      w.sent.push({ method, url: url.pathname, body: e.init?.body ? JSON.parse(String(e.init.body)) : null })
      await w.hold
      if (w.refuse) return reply(403, { message: 'user should have permission to write issue' })
      if (method === 'PATCH' && path === '/issues/29') {
        has = (JSON.parse(String(e.init?.body)) as { milestone: number }).milestone
        return reply(201, issue())
      }
      const kid = /^\/issues\/(\d+)$/.exec(path ?? '')
      if (method === 'PATCH' && kid && kids[Number(kid[1])]) {
        const n = Number(kid[1])
        if (n === w.refuseChild) return reply(403, { message: 'user should have permission to write issue' })
        kids[n] = { ...kids[n]!, milestone: (JSON.parse(String(e.init?.body)) as { milestone: number }).milestone }
        return reply(201, child(n))
      }
      return reply(404, { message: 'not found' })
    }
    if (url.pathname.endsWith('/version')) return reply(200, { version: '11.0.0' })
    if (url.pathname.endsWith('/api/v1/user')) return reply(200, { login: 'alice' })
    if (url.pathname.endsWith('/api/v1/users/alice/tokens')) {
      return reply(200, [{ name: 'whats-next', token_last_eight: 'secret', scopes: w.scopes ?? ['write:issue', 'read:repository', 'read:user'] }])
    }
    const page = Number(url.searchParams.get('page') ?? '1')
    if (url.pathname.endsWith('/issues/search')) return reply(200, page === 1 ? [issue()] : [])
    if (path === '/issues') return reply(200, w.epic && page === 1 && url.searchParams.get('labels') === 'epic' ? [issue()] : [])
    if (w.epic && path === '/issues/29/dependencies') return reply(200, page === 1 ? Object.keys(kids).map(n => child(Number(n))) : [])
    const kidPath = /^\/issues\/(3\d)(\/.*)?$/.exec(path ?? '')
    if (w.epic && kidPath) return reply(200, kidPath[2] ? [] : child(Number(kidPath[1])))
    if (path === '/milestones') {
      const state = url.searchParams.get('state')
      return reply(200, page === 1 ? (state === 'closed' ? [CLOSED] : open) : [])
    }
    if (path === '/labels') return reply(200, [])
    if (path === '/issues/29') return reply(200, issue())
    if (path === '/issues/29/comments' || path === '/issues/29/dependencies' || path === '/issues/29/blocks' || path === '/issues/29/times') return reply(200, [])
    if (path === '/issues/29/timeline') return reply(200, [])
    if (path === '') {
      return reply(200, {
        full_name: 'boats/radar',
        open_issues_count: 1,
        permissions: { push: true },
        internal_tracker: { enable_time_tracker: true, enable_issue_dependencies: true },
      })
    }
    return reply(404, { message: 'not found' })
  })
  return clock
}

type Found = { text: string; props: Record<string, unknown> }
type Ui = {
  find: (q: { key: string }) => Promise<unknown>
  findAll: (q: { type: string }) => Promise<unknown[]>
  press: (q: { key: string }) => Promise<unknown>
}
const found = async (ui: Ui) => (await ui.findAll({ type: 'Text' })) as unknown as Found[]
const texts = async (ui: Ui) => (await found(ui)).map(t => t.text)
const keys = async (ui: Ui) => ((await ui.findAll({ type: 'Button' })) as unknown as { props: { key: string } }[]).map(b => b.props.key)

async function opened($: Engine) {
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'pick-29' })
  return ui
}

// The lines of the milestone list, in order: each the Text that holds a
// name padded to its column, then its date.
type Line = Found & { children?: unknown[] }
async function lines(ui: Ui) {
  const names = ['v1.0', 'v1.1', 'v1.2', 'v2.0', 'No milestone']
  return ((await found(ui)) as Line[]).filter(t => {
    const name = t.children?.[0]
    return typeof name === 'string' && name.length === 14 && names.includes(name.trimEnd())
  })
}
const nameOf = (t: Line) => String(t.children?.[0] ?? '').trimEnd()

test('the Milestone line opens the milestone list: No milestone first, then the open ones due first, the issue\'s in bold', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
  await ui.press({ key: 'milestone-line' })
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeDefined()
  const shown = await lines(ui)
  expect(shown.map(nameOf)).toEqual(['No milestone', 'v1.1', 'v1.2', 'v2.0'])
  // The bold is on the Text around the name and the date.
  const bold = ((await ui.findAll({ type: 'Text' })) as unknown as Found[]).filter(t => t.props.bold === true).map(t => t.text)
  expect(bold.some(t => t.startsWith('v1.1'))).toBe(true)
  expect(bold.some(t => t.startsWith('v1.2'))).toBe(false)
  // Opening it asks nothing: the open milestones are known.
  expect(sent).toEqual([])
})

test('a press moves the issue at once: the list shuts, the pane stays on the issue, the Milestone line names the new one', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone-line' })
  await ui.press({ key: 'pick-milestone-2' })
  expect(sent).toEqual([{ method: 'PATCH', url: '/api/v1/repos/boats/radar/issues/29', body: { milestone: 12 } }])
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'milestone-line' })).resolves.toBeDefined()
  const all = await texts(ui)
  expect(all).toContain('v1.2')
  expect(all).not.toContain('v1.1')
})

test('No milestone takes the issue out of its own; the Milestone line then reads none, dim', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-0' })
  expect(sent).toEqual([{ method: 'PATCH', url: '/api/v1/repos/boats/radar/issues/29', body: { milestone: 0 } }])
  const none = (await found(ui)).find(t => t.text === 'none')
  expect(none?.props.dimColor).toBe(true)
})

test("a press on the issue's own milestone shuts the list and sends nothing", TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-1' })
  expect(sent).toEqual([])
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
})

test('Milestone in the menu opens the list with hotkey m; m again shuts it, and so does ☰ without opening the menu', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'menu' })
  expect(await texts(ui)).toContain('Milestone       m')
  await ui.press({ key: 'menu-milestone' })
  await expect(ui.find({ key: 'menu-milestone' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeDefined()
  expect(((await ui.find({ key: 'milestone' })) as unknown as { props: { hotkey: string } }).props.hotkey).toBe('m')
  await ui.press({ key: 'milestone' })
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'menu' })
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'menu-milestone' })).resolves.toBeUndefined()
})

test('the milestone list and the labels list: opening one shuts the other', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'labels' })
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeDefined()
  await ui.press({ key: 'milestone' })
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeDefined()
})

test("the list's frame starts on the Milestone line's row; its first line Milestone, dim, and ✕, which shuts it", TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone-line' })
  // [ ← ] row 0, the gap row 1, the heading 2, who opened it 3, a gap 4, Epic 5, Milestone 6.
  expect(((await ui.find({ key: 'milestone-list' })) as unknown as { props: { top: number } }).props.top).toBe(6)
  const all = await found(ui)
  // Room for the spinner before the name.
  expect(all.some(t => t.text.startsWith('Milestone ') && t.text.length === 19 && t.props.dimColor === true)).toBe(true)
  await ui.press({ key: 'milestones-shut' })
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeUndefined()
})

test('an issue in a closed milestone: that one first, grey and bold, then the open ones', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, milestone: 10 })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  const shown = await lines(ui)
  expect(shown.map(nameOf)).toEqual(['No milestone', 'v1.0', 'v1.1', 'v1.2', 'v2.0'])
  const closed = (await found(ui)).find(t => t.text.startsWith('v1.0') && t.props.color === 'inactive')
  expect(closed?.props.bold).toBe(true)
})

test('an issue without a milestone: Milestone reads none, dim, and No milestone is the bold one', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, milestone: 0 })
  const ui = await opened($)
  const none = (await found(ui)).find(t => t.text === 'none')
  expect(none?.props.dimColor).toBe(true)
  await ui.press({ key: 'milestone-line' })
  const bold = (await found(ui)).filter(t => t.props.bold === true).map(t => t.text.trimEnd())
  expect(bold).toContain('No milestone')
})

test('a refusal says why in red under the heading, the Milestone line as it was', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, refuse: true })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-2' })
  const red = (await found(ui)).filter(t => t.props.color === 'error').map(t => t.text)
  expect(red.join(' ')).toBe('Could not move #29 to v1.2: user should have permission to write issue.')
  expect(await texts(ui)).toContain('v1.1')
  expect(await texts(ui)).not.toContain('v1.2')
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-0' })
  const out = (await found(ui)).filter(t => t.props.color === 'error').map(t => t.text)
  expect(out.join(' ')).toBe('Could not take #29 out of v1.1: user should have permission to write issue.')
})

test('read only: no Milestone in the menu, the Milestone line no button, m does nothing', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, scopes: ['read:issue', 'read:repository', 'read:user'] })
  const ui = await opened($)
  const all = await keys(ui)
  expect(all).not.toContain('milestone')
  expect(all).not.toContain('milestone-line')
  expect(await texts(ui)).toContain('Milestone  ')
  await ui.press({ key: 'menu' })
  expect(await keys(ui)).not.toContain('menu-milestone')
})

test("the issue moved shows in What's next at once: back in the list, the milestone filter follows it", TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-2' })
  await ui.press({ key: 'back' })
  // v1.1 has no open issue left, so the milestone filter starts on v1.2,
  // where #29 now is.
  await expect(ui.find({ key: 'pick-29' })).resolves.toBeDefined()
  expect(((await ui.find({ key: 'milestone' })) as unknown as { props: { label: string } }).props.label).toBe('v1.2 ▾')
})

test('a long list is cut to the pane, and the focus on a milestone out of view scrolls it', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  const many = Array.from({ length: 60 }, (_, k) => ({ id: 100 + k, title: `m${String(k).padStart(2, '0')}`, due_on: null, open_issues: 0, closed_issues: 0 }))
  world(on, { sent, open: [...MILESTONES, ...many] })
  on('ui.focus', () => ({}))
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  // Too long to fit below the Milestone line: under the top row.
  expect(((await ui.find({ key: 'milestone-list' })) as unknown as { props: { top: number } }).props.top).toBe(1)
  const top = async () => ((await ui.find({ key: 'milestone-list-lines' })) as unknown as { props: { marginTop: number } } | undefined)?.props.marginTop
  expect(await top()).toBe(-0)
  await $.ui.focus({ component: 'Pane', requestId: 'next', plugin: 'whats-next', element: 'pick-milestone-50', origin: { kind: 'person' } })
  expect(await top()).toBeLessThan(0)
  await $.ui.focus({ component: 'Pane', requestId: 'next', plugin: 'whats-next', element: 'pick-milestone-0', origin: { kind: 'person' } })
  expect(await top()).toBe(-0)
})

// Children too (#68): an issue's open children in its old milestone move with it.

test('an epic: Children too leads the list, ticked, counting its open children in its milestone', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, epic: true })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  const all = await texts(ui)
  expect(all).toContain('☑ Children too     2')
})

test('ticked, a move takes the open children in the old milestone along; the others stay', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, epic: true })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-2' })
  expect(sent).toEqual([
    { method: 'PATCH', url: '/api/v1/repos/boats/radar/issues/29', body: { milestone: 12 } },
    { method: 'PATCH', url: '/api/v1/repos/boats/radar/issues/31', body: { milestone: 12 } },
    { method: 'PATCH', url: '/api/v1/repos/boats/radar/issues/34', body: { milestone: 12 } },
  ])
})

test('unticked, a move takes the issue alone; the choice stays until Refresh', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, epic: true })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'children-too' })
  await expect(ui.find({ key: 'milestone-list' })).resolves.toBeDefined()
  expect(await texts(ui)).toContain('☐ Children too     2')
  await ui.press({ key: 'pick-milestone-2' })
  expect(sent).toEqual([{ method: 'PATCH', url: '/api/v1/repos/boats/radar/issues/29', body: { milestone: 12 } }])
  // Opened again: still unticked. After Refresh: ticked again.
  await ui.press({ key: 'milestone' })
  expect((await texts(ui)).some(t => t.startsWith('☐ Children too'))).toBe(true)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'milestone' })
  expect((await texts(ui)).some(t => t.startsWith('☑ Children too'))).toBe(true)
})

test('No milestone, ticked, takes the open children in the old milestone out too', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, epic: true })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-0' })
  expect(sent.map(x => [x.url.split('/').pop(), x.body])).toEqual([
    ['29', { milestone: 0 }],
    ['31', { milestone: 0 }],
    ['34', { milestone: 0 }],
  ])
})

test('a child refused: the rest still move, and the refusal names it in red', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, epic: true, refuseChild: 31 })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-2' })
  expect(sent.map(x => x.url.split('/').pop())).toEqual(['29', '31', '34'])
  const red = (await found(ui)).filter(t => t.props.color === 'error').map(t => t.text)
  expect(red.join(' ')).toBe('Moved #29 to v1.2; could not move #31: user should have permission to write issue.')
})

test('the issue refused: no child is tried', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, epic: true, refuse: true })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  await ui.press({ key: 'pick-milestone-2' })
  expect(sent.map(x => x.url.split('/').pop())).toEqual(['29'])
})

test('an issue without children: no Children too', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'milestone' })
  expect((await texts(ui)).some(t => t.includes('Children too'))).toBe(false)
})

test('a press shows the new milestone at once; until the forge answers, a spinner turns before it', TOKEN, async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(go => (release = go))
  world(on, { sent: [], hold })
  const ui = await opened($)
  await ui.press({ key: 'milestone-line' })
  const pressed = ui.press({ key: 'pick-milestone-2' })
  // Let the press run up to the held write.
  for (let k = 0; k < 200; k++) await Promise.resolve()
  expect((await found(ui)).find(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] $/.test(t.text))?.props.dimColor).toBe(true)
  expect(await texts(ui)).toContain('v1.2')
  expect(await texts(ui)).not.toContain('v1.1')
  release()
  await pressed
  const all = await texts(ui)
  expect(all.some(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] /.test(t))).toBe(false)
  expect(all).toContain('v1.2')
})
