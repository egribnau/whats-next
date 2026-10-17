import { expect, test } from 'claude-code/testing'

import { forgejo } from '../hooks/forgejo'
import type { Send } from '../hooks/tracker'

// Forgejo behind the tracker: how a list is paged and narrowed to the repo,
// against a fake Send.

type Reply = { status: number; headers?: Record<string, string>; body: unknown }

function fakeSend(route: (url: URL) => Reply, asked: string[] = []): Send {
  return (async (url: string) => {
    asked.push(url)
    const r = route(new URL(url))
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      headers: r.headers ?? { 'content-type': 'application/json' },
      text: JSON.stringify(r.body),
    }
  }) as unknown as Send
}

const issue = (number: number, fullName = 'boats/radar') => ({
  number,
  title: `Issue ${number}`,
  created_at: '2026-10-01T08:00:00Z',
  html_url: `https://git.example.org/${fullName}/issues/${number}`,
  body: null,
  milestone: null,
  labels: [],
  repository: { full_name: fullName },
})

const items = (from: number, n: number) => Array.from({ length: n }, (_, k) => issue(from + k))

test('mine: a slug whose case differs from the canonical name still matches', async () => {
  const send = fakeSend(() => ({ status: 200, body: [issue(7, 'boats/radar'), issue(8, 'boats/other')] }))
  const got = await forgejo(send, { host: 'git.example.org', owner: 'Boats', name: 'Radar' }, 'tok', 'epic').mine()
  expect(got.map(i => i.number)).toEqual([7])
})

const R = { host: 'git.example.org', owner: 'boats', name: 'radar' }

test('paging: a total above the first page keeps paging until it is reached', async () => {
  const asked: string[] = []
  const send = fakeSend(url => {
    const page = url.searchParams.get('page')
    return page === '1'
      ? { status: 200, headers: { 'x-total-count': '45' }, body: items(1, 30) }
      : { status: 200, headers: { 'x-total-count': '45' }, body: items(31, 15) }
  }, asked)
  const got = await forgejo(send, R, 'tok', 'epic').mine()
  expect(got).toHaveLength(45)
  expect(asked).toHaveLength(2)
})

test('paging: without a total a page shorter than 50 is the last', async () => {
  const asked: string[] = []
  const send = fakeSend(() => ({ status: 200, body: items(1, 30) }), asked)
  const got = await forgejo(send, R, 'tok', 'epic').mine()
  expect(got).toHaveLength(30)
  expect(asked).toHaveLength(1)
})

test('paging: an empty page stops it even when the total says more', async () => {
  const asked: string[] = []
  const send = fakeSend(url => ({
    status: 200,
    headers: { 'x-total-count': '100' },
    body: url.searchParams.get('page') === '1' ? items(1, 30) : [],
  }), asked)
  const got = await forgejo(send, R, 'tok', 'epic').mine()
  expect(got).toHaveLength(30)
  expect(asked).toHaveLength(2)
})

const epic = (number: number, state = 'open', label = 'epic') => ({ number, title: `Epic ${number}`, state, labels: [{ name: label }] })

test('parentsOf: every open epic that depends on it, closed ones and non-epics left out; null when the request fails', async () => {
  const r = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const asked: string[] = []
  const blocks = [epic(30), epic(31, 'closed'), epic(32, 'open', 'bug'), epic(33)]
  const t = forgejo(fakeSend(() => ({ status: 200, body: blocks }), asked), r, 'tok', 'epic')
  expect(await t.parentsOf(41)).toEqual([30, 33])
  expect(asked).toEqual(['https://git.example.org/api/v1/repos/boats/radar/issues/41/blocks?limit=50&page=1'])
  expect(await forgejo(fakeSend(() => ({ status: 200, body: [] })), r, 'tok', 'epic').parentsOf(41)).toEqual([])
  expect(await forgejo(fakeSend(() => ({ status: 500, body: {} })), r, 'tok', 'epic').parentsOf(41)).toBeNull()
})

test('parent: POST to the epic\'s dependencies puts the issue under it, DELETE takes it out', async () => {
  const r = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const sent: { method: string; url: string; body: unknown }[] = []
  const send = (async (url: string, init?: { method?: string; body?: string }) => {
    sent.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body) : null })
    return { status: 201, ok: true, headers: {}, text: '{}' }
  }) as unknown as Send
  const t = forgejo(send, r, 'tok', 'epic')
  expect(await t.parent(41, 30, true)).toBeNull()
  expect(await t.parent(41, 30, false)).toBeNull()
  const url = 'https://git.example.org/api/v1/repos/boats/radar/issues/30/dependencies'
  const body = { owner: 'boats', repo: 'radar', index: 41 }
  expect(sent).toEqual([
    { method: 'POST', url, body },
    { method: 'DELETE', url, body },
  ])
})

test('parent: a refused change says the message Forgejo gave', async () => {
  const r = { host: 'git.example.org', owner: 'boats', name: 'radar' }
  const send = fakeSend(() => ({ status: 403, body: { message: 'user should have permission to write issue' } }))
  const t = forgejo(send, r, 'tok', 'epic')
  expect(await t.parent(41, 30, true)).toBe('user should have permission to write issue')
  expect(await t.parent(41, 30, false)).toBe('user should have permission to write issue')
})
