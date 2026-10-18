import type { FilterShown, LabelFilter, MilestoneFilter } from '../types'
import { dueFirst, type MilestoneRow } from './epics'

// The milestone filter (docs/TERMINOLOGY.md): what What's next
// and Issues show, set to a milestone, No milestone (the issues without one) or All.
// No other place knows how it is written down.

export const ALL: MilestoneFilter = { kind: 'all' }
export const NONE: MilestoneFilter = { kind: 'none' }

// The filter set to milestone `title`, or to No milestone for none.
export const ofMilestone = (title: string | null): MilestoneFilter => (title === null ? NONE : { kind: 'milestone', title })

// Whether an issue with milestone `milestone` is in what `f` is set to.
export const holds = (f: MilestoneFilter, milestone: string | null) =>
  f.kind === 'all' || (f.kind === 'none' ? milestone === null : f.title === milestone)

// Whether `a` is set to what `b` is. Anything that is no filter, as a
// session's state from older code holds, is set to nothing.
export function sameFilter(a: unknown, b: MilestoneFilter): boolean {
  if (typeof a !== 'object' || a === null) return false
  const f = a as Partial<{ kind: string; title: string }>
  return f.kind === b.kind && (b.kind !== 'milestone' || f.title === b.title)
}

// Its words on the filter's button: the milestone's title, No milestone or All.
export const filterLabel = (f: MilestoneFilter) => (f.kind === 'milestone' ? f.title : f.kind === 'none' ? 'No milestone' : 'All')

// Its word in a sentence: no milestone.
export const filterWord = (f: MilestoneFilter) => (f.kind === 'none' ? 'no milestone' : filterLabel(f))

// What it is set to after a sentence's words: " in v1.2", " without a
// milestone", or nothing for All.
export const within = (f: MilestoneFilter) => (f.kind === 'all' ? '' : f.kind === 'none' ? ' without a milestone' : ` in ${f.title}`)

// One text per setting, for a button's key and for what is remembered per setting.
export const filterKey = (f: MilestoneFilter) => (f.kind === 'milestone' ? `m:${f.title}` : f.kind)

export type FilterOption = FilterShown['options'][number]

// What the milestone filter offers: All, then No milestone when some has
// none, then each open milestone that has an open issue or an epic, due
// first (#99, decided 6d).
export function filterOptions(milestones: readonly MilestoneRow[], items: readonly { milestone: string | null }[]): FilterOption[] {
  const options: FilterOption[] = [{ filter: ALL, label: filterLabel(ALL) }]
  if (items.some(e => e.milestone === null)) options.push({ filter: NONE, label: filterLabel(NONE) })
  return options.concat(
    dueFirst(milestones)
      .filter(m => items.some(e => e.milestone === m.title))
      .map(m => ({ filter: ofMilestone(m.title), label: m.title, due: m.due })),
  )
}

// The label filter (docs/TERMINOLOGY.md): set to no labels, All, it shows every issue.
export const NO_LABELS: LabelFilter = { labels: [], mode: 'and' }

// Whether an issue with `labels` is in what `f` is set to: it has every
// label set (and) or one of them (or); with No label set, it has no label
// at all, or with or one of the labels set too (#99, decided 6b).
// Anything that is no label filter, as a session's state from older code
// holds, is set to no labels.
export function matches(f: LabelFilter | null | undefined, labels: readonly { name: string }[]): boolean {
  if (leavesOut(f, labels)) return false
  const set = Array.isArray(f?.labels) ? f.labels : []
  const bare = f?.none === true && labels.length === 0
  if (set.length === 0) return f?.none === true ? bare : true
  const has = new Set(labels.map(l => l.name))
  return f?.mode === 'or' ? bare || set.some(l => has.has(l)) : set.every(l => has.has(l))
}

// The labels `f` leaves out (☒), and whether `labels` holds one of them:
// such an issue is never in it, under and and or alike (#99, decided 7, S1).
export const leftOut = (f: LabelFilter | null | undefined): string[] => (Array.isArray(f?.not) ? f.not : [])
export const leavesOut = (f: LabelFilter | null | undefined, labels: readonly { name: string }[]) =>
  leftOut(f).some(n => labels.some(l => l.name === n))

// Whether `f` is set on All: no label set, none left out, not No label;
// anything that is no label filter is.
export const isAll = (f: LabelFilter | null | undefined) =>
  !(Array.isArray(f?.labels) && f.labels.length > 0) && f?.none !== true && leftOut(f).length === 0

// What a press on label `name`'s box makes of `f`: ☐ set (☑), ☑ left out
// (☒), ☒ neither (☐) again (#99, decided 7, X1).
export function stepLabel(f: LabelFilter, name: string): LabelFilter {
  const not = leftOut(f)
  if (f.labels.includes(name)) return { ...withLabel(f, name, false), not: [...not.filter(n => n !== name), name] }
  if (not.includes(name)) return { ...f, not: not.filter(n => n !== name) }
  return withLabel(f, name, true)
}

// Label `name` set in `f` (`on`) or taken out of it; under and, a label set
// leaves No label, under or it ticks along with it (#99, decided 6c).
export const withLabel = (f: LabelFilter, name: string, on: boolean): LabelFilter => ({
  ...f,
  none: f.mode === 'or' && f.none === true,
  labels: on ? [...f.labels.filter(l => l !== name), name] : f.labels.filter(l => l !== name),
})

// `f` set to and or or; and takes No label out while a label is set, as
// the two never match together (#99, decided K1).
export const withMode = (f: LabelFilter, mode: LabelFilter['mode']): LabelFilter => ({
  ...f,
  mode,
  none: f.none === true && (mode === 'or' || f.labels.length === 0),
})

// The word No label, on the button and in the list.
export const NO_LABEL = 'No label'

// Its words on the filter's button, as the milestone filter's: All, No
// label, or the labels set joined by the word set, `docs and readme`, with
// No label first when it ticks along: `No label or docs`; then each label
// left out after `not`: `docs, not bug`, `not bug, not wontfix`.
export const labelWords = (f: LabelFilter): { word: string } | { labels: string[]; join: string; none: boolean; not: string[] } =>
  f.labels.length === 0 && leftOut(f).length === 0
    ? { word: f.none === true ? NO_LABEL : 'All' }
    : { labels: f.labels, join: ` ${f.mode} `, none: f.none === true && (f.mode === 'or' || f.labels.length === 0), not: leftOut(f) }
