import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

// The epic list (#74, DRAWING-issue.md, The epic list): an issue put under
// an epic and taken out of one from the issue detail, on Forgejo, where an
// epic depends on its children and an issue may be under several.

type Engine = Parameters<TestBody>[0]

const PANE = {
  plugin: 'whats-next',
  component: 'Pane',
  requestId: 'next',
  props: {
    title: "What's Next",
    isFocused: false,
    bodyColumns: 70,
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

const MILESTONES = [
  { id: 12, title: 'v1.2', due_on: '2026-11-20T00:00:00Z', open_issues: 1, closed_issues: 0 },
  { id: 11, title: 'v1.1', due_on: '2026-10-30T00:00:00Z', open_issues: 2, closed_issues: 0 },
]

type Sent = { method: string; url: string; body: unknown }
type World = {
  // The epics #29 is under, changed by what is sent.
  under?: number[]
  scopes?: string[]
  refuse?: boolean
  // A write held until this settles, to see the pane while it waits.
  hold?: Promise<void>
  sent: Sent[]
}

// Forgejo with #29, and the open epics #40 in v1.2, #12 in v1.1 and #8
// without a milestone: the list shows them in the Issues pane's order, #12,
// #40, #8.
function world(on: On, w: World) {
  const clock = mock.clock(on)
  const under = new Set(w.under ?? [12])
  const milestone = (id: number | null) => MILESTONES.find(m => m.id === id) ?? null
  const issue = (n: number, title: string, ms: number | null, epic: boolean) => ({
    number: n,
    title,
    state: 'open',
    html_url: `https://git.example.org/boats/radar/issues/${n}`,
    body: '',
    user: { login: 'alice' },
    created_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-10-07T12:00:00Z',
    comments: 0,
    milestone: milestone(ms),
    due_date: null,
    labels: epic ? [{ name: 'epic', color: '' }] : [],
    assignees: [],
    repository: { full_name: 'boats/radar' },
  })
  const epics = [issue(40, 'Release notes', 12, true), issue(12, 'Config overhaul', 11, true), issue(8, 'Docs site', null, true)]
  const own = () => issue(29, 'Docs: config keys', 11, false)
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
    const page = Number(url.searchParams.get('page') ?? '1')
    const deps = /^\/issues\/(\d+)\/dependencies$/.exec(path ?? '')
    if (method !== 'GET') {
      w.sent.push({ method, url: url.pathname, body: e.init?.body ? JSON.parse(String(e.init.body)) : null })
      await w.hold
      if (w.refuse) return reply(403, { message: 'user should have permission to write issue' })
      if (deps) {
        const p = Number(deps[1])
        if (method === 'POST') under.add(p)
        else under.delete(p)
        return reply(201, own())
      }
      return reply(404, { message: 'not found' })
    }
    if (url.pathname.endsWith('/version')) return reply(200, { version: '11.0.0' })
    if (url.pathname.endsWith('/api/v1/user')) return reply(200, { login: 'alice' })
    if (url.pathname.endsWith('/api/v1/users/alice/tokens')) {
      return reply(200, [{ name: 'whats-next', token_last_eight: 'secret', scopes: w.scopes ?? ['write:issue', 'read:repository', 'read:user'] }])
    }
    if (url.pathname.endsWith('/issues/search')) return reply(200, page === 1 ? [own()] : [])
    if (path === '/issues') return reply(200, page === 1 && url.searchParams.get('labels') === 'epic' ? epics : [])
    // An epic depends on its children: #29 where it is under it.
    if (deps) return reply(200, page === 1 && under.has(Number(deps[1])) ? [own()] : [])
    if (path === '/issues/29/blocks') return reply(200, page === 1 ? epics.filter(x => under.has(x.number)) : [])
    if (path === '/milestones') return reply(200, page === 1 && url.searchParams.get('state') !== 'closed' ? MILESTONES : [])
    if (path === '/labels') return reply(200, [])
    if (path === '/issues/29') return reply(200, own())
    const one = /^\/issues\/(\d+)$/.exec(path ?? '')
    const epic = epics.find(x => x.number === Number(one?.[1]))
    if (epic) return reply(200, epic)
    if (/^\/issues\/\d+\/(comments|blocks|times|timeline)$/.test(path ?? '')) return reply(200, [])
    if (path === '') {
      return reply(200, {
        full_name: 'boats/radar',
        open_issues_count: 4,
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

// The lines of the epic list, in order, each as its box, number and title.
async function choices(ui: Ui) {
  return (await texts(ui)).filter(t => /^(☑|☐) /.test(t) || t.trimEnd() === 'No epic').map(t => t.replace(/\s+/g, ' ').trim())
}

test('the Epic line opens the epic list: No epic first, then the open epics in the Issues order, the ones it is under ticked', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await expect(ui.find({ key: 'parent-list' })).resolves.toBeUndefined()
  await ui.press({ key: 'parent-0-line' })
  await expect(ui.find({ key: 'parent-list' })).resolves.toBeDefined()
  expect(await choices(ui)).toEqual(['No epic', '☑ ○ #12 Config overhaul', '☐ ○ #40 Release notes', '☐ ○ #8 Docs site'])
  // Opening it writes nothing.
  expect(sent).toEqual([])
})

test('the → at the end of the Epic line opens the epic itself', TOKEN, async ($, on) => {
  world(on, { sent: [] })
  const ui = await opened($)
  expect(await texts(ui)).toContain('→')
  await ui.press({ key: 'follow-12' })
  expect((await texts(ui)).some(t => t.includes('Config overhaul'))).toBe(true)
  await expect(ui.find({ key: 'parent-0-line' })).resolves.toBeUndefined()
})

test('a press puts the issue under another epic too: a dependency on that epic; the list stays open, an Epic line each', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'parent-0-line' })
  await ui.press({ key: 'pick-parent-2' })
  expect(sent).toEqual([{ method: 'POST', url: '/api/v1/repos/boats/radar/issues/40/dependencies', body: { owner: 'boats', repo: 'radar', index: 29 } }])
  await expect(ui.find({ key: 'parent-list' })).resolves.toBeDefined()
  expect(await choices(ui)).toEqual(['No epic', '☑ ○ #12 Config overhaul', '☑ ○ #40 Release notes', '☐ ○ #8 Docs site'])
  const all = await keys(ui)
  expect(all).toContain('parent-0-line')
  expect(all).toContain('parent-1-line')
  expect(all).toContain('follow-40')
})

test('a press on a ticked epic takes the issue out of it', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'parent-0-line' })
  await ui.press({ key: 'pick-parent-1' })
  expect(sent).toEqual([{ method: 'DELETE', url: '/api/v1/repos/boats/radar/issues/12/dependencies', body: { owner: 'boats', repo: 'radar', index: 29 } }])
  expect(await choices(ui)).toEqual(['No epic', '☐ ○ #12 Config overhaul', '☐ ○ #40 Release notes', '☐ ○ #8 Docs site'])
})

test('No epic takes the issue out of every epic it is under; the Epic line then reads none, dim', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent, under: [12, 40] })
  const ui = await opened($)
  await ui.press({ key: 'parents' })
  await ui.press({ key: 'pick-parent-0' })
  expect(sent.map(s => `${s.method} ${s.url}`)).toEqual([
    'DELETE /api/v1/repos/boats/radar/issues/12/dependencies',
    'DELETE /api/v1/repos/boats/radar/issues/40/dependencies',
  ])
  const none = (await found(ui)).find(t => t.text === 'none')
  expect(none?.props.dimColor).toBe(true)
})

test('without a parent the Epic line reads none, dim, and opens the list; Epic in the menu with hotkey e opens it too', TOKEN, async ($, on) => {
  world(on, { sent: [], under: [] })
  const ui = await opened($)
  const all = await texts(ui)
  expect(all).toContain('Epic       ')
  expect((await found(ui)).find(t => t.text === 'none')?.props.dimColor).toBe(true)
  await ui.press({ key: 'menu' })
  expect(await texts(ui)).toContain('Epic            e')
  await ui.press({ key: 'parents' })
  expect(await choices(ui)).toEqual(['No epic', '☐ ○ #12 Config overhaul', '☐ ○ #40 Release notes', '☐ ○ #8 Docs site'])
  await ui.press({ key: 'parents' })
  await expect(ui.find({ key: 'parent-list' })).resolves.toBeUndefined()
})

test('a refusal says why in red under the heading, in the words put under', TOKEN, async ($, on) => {
  world(on, { sent: [], refuse: true })
  const ui = await opened($)
  await ui.press({ key: 'parent-0-line' })
  await ui.press({ key: 'pick-parent-2' })
  const red = (await found(ui)).filter(t => t.props.color === 'error').map(t => t.text)
  expect(red.join(' ')).toBe('Could not put #29 under #40: user should have permission to write issue.')
  // The tick that moved at once goes back.
  expect(await choices(ui)).toEqual(['No epic', '☑ ○ #12 Config overhaul', '☐ ○ #40 Release notes', '☐ ○ #8 Docs site'])
})

test('read only: no Epic in the menu, the Epic line plain text, its → still opens the epic', { options: { ...TOKEN.options } }, async ($, on) => {
  world(on, { sent: [], scopes: ['read:issue', 'read:repository', 'read:user'] })
  const ui = await opened($)
  const all = await keys(ui)
  expect(all).not.toContain('parents')
  expect(all).not.toContain('parent-0-line')
  expect(all).toContain('follow-12')
  await ui.press({ key: 'menu' })
  expect((await texts(ui)).join(' ')).toContain('milestone and epic need')
})

test('a press while a change is on its way is passed over: one request, the first one ticked', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'parent-0-line' })
  await Promise.all([ui.press({ key: 'pick-parent-2' }), ui.press({ key: 'pick-parent-3' })])
  expect(sent.map(x => `${x.method} ${x.url}`)).toEqual(['POST /api/v1/repos/boats/radar/issues/40/dependencies'])
  expect(await choices(ui)).toEqual(['No epic', '☑ ○ #12 Config overhaul', '☑ ○ #40 Release notes', '☐ ○ #8 Docs site'])
})

test('once the forge has answered, the next press goes through while the lists are read again', TOKEN, async ($, on) => {
  const sent: Sent[] = []
  world(on, { sent })
  const ui = await opened($)
  await ui.press({ key: 'parent-0-line' })
  await ui.press({ key: 'pick-parent-2' })
  await ui.press({ key: 'pick-parent-3' })
  expect(sent.map(x => `${x.method} ${x.url}`)).toEqual([
    'POST /api/v1/repos/boats/radar/issues/40/dependencies',
    'POST /api/v1/repos/boats/radar/issues/8/dependencies',
  ])
  expect(await choices(ui)).toEqual(['No epic', '☑ ○ #12 Config overhaul', '☑ ○ #40 Release notes', '☑ ○ #8 Docs site'])
})

test('until the forge answers, a spinner turns before the epic list name, and its lines are dim', TOKEN, async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(go => (release = go))
  world(on, { sent: [], hold })
  const ui = await opened($)
  await ui.press({ key: 'parent-0-line' })
  const pressed = ui.press({ key: 'pick-parent-2' })
  // Let the press run up to the held write.
  for (let k = 0; k < 200; k++) await Promise.resolve()
  const shown = await found(ui)
  expect(shown.find(t => /^Epic +[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] +$/.test(t.text))?.props.dimColor).toBe(true)
  expect(shown.find(t => t.text.startsWith('☑ ○ #40 Release notes'))?.props.dimColor).toBe(true)
  release()
  await pressed
  const after = await texts(ui)
  expect(after.some(t => /^Epic +[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(t))).toBe(false)
  expect(after).toContain('Epic                                   ')
})
