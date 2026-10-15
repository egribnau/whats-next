import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

import { forgejo } from '../hooks/forgejo'
import { github } from '../hooks/github'
import { gitlab } from '../hooks/gitlab'
import type { Send } from '../hooks/tracker'
import type { Repo } from '../types'

// The labels list (#66, DRAWING-issue.md, The labels list): the repo's
// labels from each forge, a label added and taken off on each, then the
// list in the issue detail of the pane.

type Engine = Parameters<TestBody>[0]

// A fake Send that answers by method and URL, and keeps what was sent.
type Sent = { method: string; url: string; body: unknown }
function fake(answer: (method: string, url: string) => { status: number; body: unknown; headers?: Record<string, string> }) {
  const sent: Sent[] = []
  const send: Send = async (url, init) => {
    const method = init?.method ?? 'GET'
    sent.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const a = answer(method, url)
    return { status: a.status, ok: a.status >= 200 && a.status < 300, headers: a.headers ?? {}, text: JSON.stringify(a.body) }
  }
  return { send, sent }
}

test('Forgejo: the repo labels with their ids; added by id with POST, taken off by id with DELETE', async () => {
  const r: Repo = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const api = 'https://git.example.org/api/v1/repos/boats/radar'
  const { send, sent } = fake((method, url) =>
    method === 'GET' && url.startsWith(`${api}/labels`)
      ? { status: 200, body: new URL(url).searchParams.get('page') === '1' ? [{ id: 7, name: 'bug', color: 'e11d21' }, { id: 9, name: 'docs', color: '0075ca' }] : [] }
      : { status: method === 'DELETE' ? 204 : 200, body: [] },
  )
  const t = forgejo(send, r, 'secret', 'epic', '11.0.0')
  expect(await t.labels()).toEqual([
    { name: 'bug', color: 'e11d21', id: 7 },
    { name: 'docs', color: '0075ca', id: 9 },
  ])
  sent.length = 0
  expect(await t.label(29, { name: 'bug', color: 'e11d21', id: 7 }, true)).toBeNull()
  expect(await t.label(29, { name: 'docs', color: '0075ca', id: 9 }, false)).toBeNull()
  expect(sent).toEqual([
    { method: 'POST', url: `${api}/issues/29/labels`, body: { labels: [7] } },
    { method: 'DELETE', url: `${api}/issues/29/labels/9`, body: null },
  ])
})

test('Forgejo: a refused label says Forgejo message', async () => {
  const r: Repo = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const { send } = fake(() => ({ status: 403, body: { message: 'user should have permission to write issue' } }))
  const t = forgejo(send, r, 'secret', 'epic', '11.0.0')
  expect(await t.label(29, { name: 'bug', color: '', id: 7 }, true)).toBe('user should have permission to write issue')
})

test('GitLab: the project labels and its groups, colours without #; added and taken off by name', async () => {
  const r: Repo = { host: 'gitlab.com', owner: 'boats', name: 'radar' }
  const project = 'https://gitlab.com/api/v4/projects/boats%2Fradar'
  const { send, sent } = fake((method, url) =>
    method === 'GET' && url.startsWith(`${project}/labels`)
      ? { status: 200, body: [{ id: 1, name: 'bug', color: '#d9534f' }, { id: 2, name: 'group::ux', color: '#428bca' }], headers: { 'x-next-page': '' } }
      : { status: 200, body: {} },
  )
  const t = gitlab(send, r, 'glpat-secret', null)
  expect(await t.labels()).toEqual([
    { name: 'bug', color: 'd9534f' },
    { name: 'group::ux', color: '428bca' },
  ])
  expect(sent[0]?.url).toContain('include_ancestor_groups=true')
  sent.length = 0
  expect(await t.label(29, { name: 'bug', color: 'd9534f' }, true)).toBeNull()
  expect(await t.label(29, { name: 'group::ux', color: '428bca' }, false)).toBeNull()
  expect(sent).toEqual([
    { method: 'PUT', url: `${project}/issues/29`, body: { add_labels: 'bug' } },
    { method: 'PUT', url: `${project}/issues/29`, body: { remove_labels: 'group::ux' } },
  ])
})

test('GitLab: a refused label says GitLab message', async () => {
  const r: Repo = { host: 'gitlab.com', owner: 'boats', name: 'radar' }
  const { send } = fake(() => ({ status: 403, body: { message: '403 Forbidden' } }))
  const t = gitlab(send, r, 'glpat-secret', null)
  expect(await t.label(29, { name: 'bug', color: '' }, true)).toBe('403 Forbidden')
})

test('GitHub: the repo labels; added by name with POST, taken off by name with DELETE', async () => {
  const r: Repo = { host: 'github.com', owner: 'boats', name: 'radar' }
  const api = 'https://api.github.com/repos/boats/radar'
  const { send, sent } = fake((method, url) =>
    method === 'GET' && url.startsWith(`${api}/labels`)
      ? { status: 200, body: [{ id: 11, name: 'bug', color: 'd73a4a' }, { id: 12, name: 'good first issue', color: '7057ff' }] }
      : { status: 200, body: [] },
  )
  const t = github(send, r, 'ghp_secret', null)
  expect(await t.labels()).toEqual([
    { name: 'bug', color: 'd73a4a' },
    { name: 'good first issue', color: '7057ff' },
  ])
  sent.length = 0
  expect(await t.label(14, { name: 'bug', color: 'd73a4a' }, true)).toBeNull()
  expect(await t.label(14, { name: 'good first issue', color: '7057ff' }, false)).toBeNull()
  expect(sent).toEqual([
    { method: 'POST', url: `${api}/issues/14/labels`, body: { labels: ['bug'] } },
    { method: 'DELETE', url: `${api}/issues/14/labels/good%20first%20issue`, body: null },
  ])
})

test('GitHub: a refused label says GitHub message; a refused list throws, naming the labels', async () => {
  const r: Repo = { host: 'github.com', owner: 'boats', name: 'radar' }
  const { send } = fake(() => ({ status: 403, body: { message: 'Must have push access' } }))
  const t = github(send, r, 'ghp_secret', null)
  expect(await t.label(14, { name: 'bug', color: '' }, true)).toBe('HTTP 403, Must have push access')
  await expect(t.labels()).rejects.toThrow('labels')
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

const LISTED = {
  number: 29,
  title: 'Docs: config keys',
  state: 'open',
  created_at: '2026-09-18T09:00:00Z',
  html_url: 'https://git.example.org/boats/radar/issues/29',
  body: 'Short.',
  milestone: null,
  labels: [{ name: 'docs', color: '0075ca' }],
  repository: { full_name: 'boats/radar' },
}

const ISSUE = {
  number: 29,
  title: 'Docs: config keys',
  state: 'open',
  html_url: 'https://git.example.org/boats/radar/issues/29',
  body: 'Short.',
  user: { login: 'alice' },
  created_at: '2026-09-18T09:00:00Z',
  updated_at: '2026-10-07T12:00:00Z',
  comments: 0,
  milestone: null,
  due_date: null,
}

const LABELS = [
  { id: 9, name: 'docs', color: '0075ca' },
  { id: 7, name: 'bug', color: 'e11d21' },
  { id: 8, name: 'Epic', color: '888888' },
]

type World = {
  // The issue's labels, changed by what is sent.
  labels?: { name: string; color: string }[]
  repoLabels?: unknown[]
  // The scopes of the token: write:issue unless it says otherwise.
  scopes?: string[]
  refuse?: boolean
  sent: Sent[]
  // Each time the repo labels are asked for.
  asked?: string[]
}

function world(on: On, w: World) {
  const clock = mock.clock(on)
  let has = w.labels ?? [{ name: 'docs', color: '0075ca' }]
  on('process.run', (_$, e) => {
    const cmd = e.argv.join(' ')
    const stdout = cmd === 'git remote get-url origin' ? 'git@git.example.org:boats/radar.git' : 'true'
    return { value: { exitCode: 0, stdout: `${stdout}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('http.fetch', (_$, e) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const reply = (status: number, body: unknown) => ({
      value: { status, ok: status >= 200 && status < 300, headers: {}, text: JSON.stringify(body) },
    })
    const path = e.url.startsWith(API) ? url.pathname.slice(new URL(API).pathname.length) : null
    if (method !== 'GET') {
      w.sent.push({ method, url: `${url.pathname}`, body: e.init?.body ? JSON.parse(String(e.init.body)) : null })
      if (w.refuse) return reply(403, { message: 'user should have permission to write issue' })
      const byId = (id: number) => LABELS.find(l => l.id === id)
      if (method === 'POST' && path === '/issues/29/labels') {
        const add = byId((JSON.parse(String(e.init?.body)) as { labels: number[] }).labels[0] ?? 0)
        if (add) has = [...has, { name: add.name, color: add.color }]
        return reply(200, has)
      }
      const off = /^\/issues\/29\/labels\/(\d+)$/.exec(path ?? '')
      if (method === 'DELETE' && off) {
        has = has.filter(l => l.name !== byId(Number(off[1]))?.name)
        return reply(204, null)
      }
      return reply(404, { message: 'not found' })
    }
    if (url.pathname.endsWith('/version')) return reply(200, { version: '11.0.0' })
    if (url.pathname.endsWith('/api/v1/user')) return reply(200, { login: 'alice' })
    if (url.pathname.endsWith('/api/v1/users/alice/tokens')) {
      return reply(200, [{ name: 'whats-next', token_last_eight: 'secret', scopes: w.scopes ?? ['write:issue', 'read:repository', 'read:user'] }])
    }
    const page = Number(url.searchParams.get('page') ?? '1')
    if (url.pathname.endsWith('/issues/search')) return reply(200, page === 1 ? [{ ...LISTED, labels: has }] : [])
    if (path === '/issues') return reply(200, [])
    if (path === '/labels') w.asked?.push(e.url)
    if (path === '/labels') return reply(200, page === 1 ? (w.repoLabels ?? LABELS) : [])
    if (path === '/issues/29') return reply(200, { ...ISSUE, labels: has })
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
const texts = async (ui: Ui) => ((await ui.findAll({ type: 'Text' })) as unknown as Found[]).map(t => t.text)
const keys = async (ui: Ui) => ((await ui.findAll({ type: 'Button' })) as unknown as { props: { key: string } }[]).map(b => b.props.key)

async function opened($: Engine) {
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'pick-29' })
  return ui
}

// The k-th line of the labels list: its box and its label's name.
async function line(ui: Ui, k: number) {
  return ((await texts(ui)).filter(t => /^[☐☑] /.test(t))[k] ?? '').trimEnd()
}

test('the Labels line opens the labels list: the repo labels by name, a box saying which the issue has', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeUndefined()
  await ui.press({ key: 'labels-line' })
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeDefined()
  expect([await line(ui, 0), await line(ui, 1), await line(ui, 2)]).toEqual(['☐ bug', '☑ docs', '☐ Epic'])
  // Each label in its colour, as everywhere.
  const bug = ((await ui.findAll({ type: 'Text' })) as unknown as Found[]).find(t => t.text === 'bug')
  expect(bug?.props.color).toBeDefined()
})

test('a press adds the label at once: the list stays open, the Labels line shows it; another takes one off', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'labels-line' })
  await ui.press({ key: 'toggle-label-0' })
  expect(sent).toEqual([{ method: 'POST', url: '/api/v1/repos/boats/radar/issues/29/labels', body: { labels: [7] } }])
  // Still on the issue, the list open, bug ticked.
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeDefined()
  expect(await line(ui, 0)).toBe('☑ bug')
  await expect(ui.find({ key: 'labels-line' })).resolves.toBeDefined()
  await ui.press({ key: 'toggle-label-1' })
  expect(sent[1]).toEqual({ method: 'DELETE', url: '/api/v1/repos/boats/radar/issues/29/labels/9', body: null })
  expect(await line(ui, 1)).toBe('☐ docs')
  // Shut: the Labels line names bug alone.
  await ui.press({ key: 'labels' })
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeUndefined()
  const all = await texts(ui)
  expect(all).toContain('bug')
  expect(all).not.toContain('docs')
})

test('Labels in the menu opens the list with hotkey l; l again shuts it, and so does ☰ without opening the menu', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'menu' })
  expect(await texts(ui)).toContain('Labels          l')
  await ui.press({ key: 'menu-labels' })
  await expect(ui.find({ key: 'menu-labels' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeDefined()
  expect(((await ui.find({ key: 'labels' })) as unknown as { props: { hotkey: string } }).props.hotkey).toBe('l')
  await ui.press({ key: 'labels' })
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeUndefined()
  await ui.press({ key: 'labels' })
  await ui.press({ key: 'menu' })
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'menu-labels' })).resolves.toBeUndefined()
})

test('the list\'s frame starts on the Labels line\'s row', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'labels-line' })
  const topOf = async () => ((await ui.find({ key: 'labels-list' })) as unknown as { props: { top: number } }).props.top
  // [ ← ] row 0, the gap row 1, the heading 2, who opened it 3, a gap 4,
  // Milestone 5, Labels 6.
  expect(await topOf()).toBe(6)
})

test('a list too long to fit below the Labels line starts under the top row', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, repoLabels: Array.from({ length: 60 }, (_, k) => ({ id: 100 + k, name: `l${k}`, color: '' })) })
  const ui = await opened($)
  await ui.press({ key: 'labels-line' })
  expect(((await ui.find({ key: 'labels-list' })) as unknown as { props: { top: number } }).props.top).toBe(1)
})

test('the first line of the list: Labels, dim, and ✕, which shuts it', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'labels-line' })
  const found = (await ui.findAll({ type: 'Text' })) as unknown as Found[]
  expect(found.some(t => t.text === 'Labels ' && t.props.dimColor === true)).toBe(true)
  expect(found.some(t => t.text === '✕')).toBe(true)
  await ui.press({ key: 'labels-shut' })
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeUndefined()
  await expect(ui.find({ key: 'labels-line' })).resolves.toBeDefined()
})

test('the repo labels are asked once, until Refresh', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  const asked: string[] = []
  world(on, { sent, asked })
  const ui = await opened($)
  await ui.press({ key: 'labels' })
  await ui.press({ key: 'labels' })
  await ui.press({ key: 'labels' })
  expect(asked).toHaveLength(1)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'labels' })
  expect(asked.length).toBeGreaterThan(1)
})

test('a refusal says why in red under the heading, and the list stays open as it was', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, refuse: true })
  const ui = await opened($)
  await ui.press({ key: 'labels-line' })
  await ui.press({ key: 'toggle-label-0' })
  const red = ((await ui.findAll({ type: 'Text' })) as unknown as Found[]).filter(t => t.props.color === 'error').map(t => t.text)
  expect(red.join(' ')).toBe('Could not add bug to #29: user should have permission to write issue.')
  await expect(ui.find({ key: 'labels-list' })).resolves.toBeDefined()
  expect(await line(ui, 0)).toBe('☐ bug')
})

test('an issue without labels: Labels reads none, dim, so there is something to press', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, labels: [] })
  const ui = await opened($)
  const none = ((await ui.findAll({ type: 'Text' })) as unknown as Found[]).find(t => t.text === 'none')
  expect(none?.props.dimColor).toBe(true)
  await ui.press({ key: 'labels-line' })
  expect(await line(ui, 0)).toBe('☐ bug')
})

test('a repo without labels: the list says so, dim', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, repoLabels: [] })
  const ui = await opened($)
  await ui.press({ key: 'labels' })
  const said = ((await ui.findAll({ type: 'Text' })) as unknown as Found[]).find(t => t.text === 'No labels in boats/radar.')
  expect(said?.props.dimColor).toBe(true)
})

test('read only: no Labels in the menu, the Labels line no button, l does nothing', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, scopes: ['read:issue', 'read:repository', 'read:user'] })
  const ui = await opened($)
  const all = await keys(ui)
  expect(all).not.toContain('labels')
  expect(all).not.toContain('labels-line')
  expect(await texts(ui)).toContain('Labels     ')
  await ui.press({ key: 'menu' })
  expect(await keys(ui)).not.toContain('menu-labels')
})

test('a long list is cut to the pane, and the focus on a label out of view scrolls it', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  const many = Array.from({ length: 60 }, (_, k) => ({ id: 100 + k, name: `l${String(k).padStart(2, '0')}`, color: '' }))
  world(on, { sent, repoLabels: many })
  on('ui.focus', () => ({}))
  const ui = await opened($)
  await ui.press({ key: 'labels' })
  const top = async () => ((await ui.find({ key: 'labels-list-lines' })) as unknown as { props: { marginTop: number } } | undefined)?.props.marginTop
  expect(await top()).toBe(-0)
  await $.ui.focus({ component: 'Pane', requestId: 'next', plugin: 'whats-next', element: 'toggle-label-50', origin: { kind: 'person' } })
  expect(await top()).toBeLessThan(0)
  await $.ui.focus({ component: 'Pane', requestId: 'next', plugin: 'whats-next', element: 'toggle-label-0', origin: { kind: 'person' } })
  expect(await top()).toBe(-0)
})
