# What's Next: ordering Next and the Queue

How What's next chooses Next and orders the Queue: which issues come
first, and why. How the result is drawn (the rules, `↦ n`, Last closed)
is in DRAWING.md and DRAWING-issue.md; the words are in TERMINOLOGY.md.
A change to the order changes this file first, then the code, then the
canvas artboards "What's next, ordered by where you are" and "Due soon
first".

Built in 0.67.0 (#57); due soon first in 1.1.0 (#70). Where you work is not called focus: focus is the
keyboard's.

## In short

An issue due soon comes first, wherever it is. After those, Next follows
on from what you did last: What's next finds where you work, takes the
issues there first and widens step by step when nothing is left. Within
each step it orders by a few keys, one after the other: no score, no
weights. A row's place is explained by the step it is in (said in the
Next rule and the Queue's headings) and the key that set it apart (said
on its facts line).

## Due soon

An issue is due soon when the due date that counts for it is within 7
days or past. The 7 days are the same as for an amber due date
(DRAWING.md, Due dates).

The due date that counts is the earliest of:

- its own due date;
- the due date of each epic it is in (on Forgejo and GitLab an epic is
  an issue, with a due date of its own; a GitHub parent issue has none);
- its milestone's due date.

The earliest, not the nearest: a child is done when its epic is due,
whatever its own date says. GitHub issues have no due date of their own,
so only a milestone's counts there. How a row shows the date that counts,
and whose it is: DRAWING-issue.md, The facts line.

## Where you work

Per milestone filter setting, the issue you work from is:

1. your issue in progress in the milestone filter updated last (a
   comment, a commit naming it, a label: the lists say when, so it costs
   nothing; IssueRow gains `updated`);
2. with none, the last issue you closed in the milestone filter (Last closed);
3. with neither, there is none, and the order is the filter's, as
   below.

Where you work is that issue's epic, else its milestone. The milestone filter: a milestone,
No milestone or All. Set the filter to v1.3 and Next follows on from what you
did in v1.3, not elsewhere; All follows on from what you did anywhere.

A close counts from anywhere: the pane, the browser, a `closes #41`
commit. The forge is asked, not the pane's memory.

## Scopes: how where you work widens

The available issues of the milestone filter are taken in scopes, in this order:

| # | Scope | Holds |
|---|---|---|
| 0 | due soon | every available issue of the milestone filter that is due soon, whichever scope below holds it |
| 1 | the epic | the open children in the milestone filter of the epic you work in |
| 2 | its parent epic | the parent's open children in the milestone filter, those of 1 left out; only on GitHub, where a child can have children; each parent up the tree is a scope of its own |
| 3 | the milestone | the rest of the milestone of the issue you work from, in the milestone filter |
| 4 | the milestone filter | the rest of the filter |

An issue is in the first scope that holds it, so one due soon is in 0
and nowhere else. Within 0, the earliest due date that counts comes
first; a tie goes to the scope below that holds it (so a milestone due
soon, which gives all its issues the same date, keeps where you work
first), then to the keys. A scope with nothing in it is skipped. When the issue you work from is in
no epic, scopes 1 and 2 are skipped; without an issue to work from,
only 4 is left, and the order is the keys below over the whole filter. With the
filter set to a milestone, 3 and 4 hold the same issues, so 3 is left
out and its issues are in 4: the rules name no milestone.

Next is the first available issue of the first scope that has one.
The Queue goes on from there, through the same scopes, until its limit
(QUEUE_LIMIT). Blocked issues met on the way go to the blocked rows at
the end, under their own heading when the Queue has headings
(DRAWING.md, Headings).

An issue due soon outside the milestone filter is not taken: the filter
holds. The available ones are counted, and the pane says how many under
Due soon (DRAWING.md, Rules).

## Keys: the order within a scope

Within a scope, issues are sorted by these keys; a tie on one goes to
the next.

| # | Key | First | Known from |
|---|---|---|---|
| 1 | unblocks | the most open issues waiting on it first | GitHub: the list counts them (`issue_dependencies_summary`); Forgejo and GitLab: the blocker checks made so far, so what the walk has not checked counts as 0 |
| 2 | age | oldest first, then lowest number | the lists |

Due soon is a scope, not a key: until 1.1.0 (#70) it was the first key
within each scope, so an issue due tomorrow waited behind every issue of
the epic you work in.

The keys are read from what is known when the walk starts; the walk
does not reorder as it checks blockers. The order is the same for the
same answers from the forge.

Priority is not a key: there is no source for it yet.

## In progress

Your issues in progress come due soon first, the earliest due date that
counts first; the rest after, oldest first, as before. Their order does
not change where you work: that stays the one updated last.

## Where the milestone filter starts

On `/next` the milestone filter starts where you work:

1. the milestone of your issue in progress updated last;
2. with none, the milestone of the last issue you closed in the repo;
3. with neither, the open milestone due first, as before #57.

That issue without a milestone starts it on No milestone. When an open issue of
yours or an available one is due soon and not in that milestone, it
starts on All instead, so an issue due soon is in front when you open
the pane (#70). A milestone you
choose yourself holds until the next `/next`.

## What it asks the forge

Asked the first time the milestone filter is set to something, then remembered until Refresh:

| Request | Count | Forgejo | GitLab | GitHub |
|---|---|---|---|---|
| your last closed issue in the milestone filter | 1 | the first page of the repo's closed issues assigned to you, in that milestone; the latest closed of it | the first page, newest change first; the latest closed of it | the same, pull requests left out |
| the epic of the issue you work from | 1 | the open epics that depend on it (`/blocks`) | its related links to an open issue with the Epic label | its parent issue, open, in this repo |
| the epic of your last closed issue, when you work from an issue in progress | 1 | the same | the same | the same |
| the epic's children | 1, or none when Issues already loaded them | its dependencies | its related links | its sub-issues |
| each parent epic up the tree | 2 each (its parent, its children) | | | GitHub only |
| the children of each open epic due soon, for the due date that counts | 1 each, or none when Issues or the scopes already loaded them | its dependencies | its related links | none: a parent issue has no due date |

All asks without a milestone; No milestone asks for issues without one
(Forgejo cannot filter that: its list is filtered here). The All answer is
also the answer for its own milestone, which is then not asked. Where the
milestone filter starts uses the All request, asked first, so it costs
nothing more. On Forgejo with dependencies off, an epic has no children:
nothing is asked for the epic. Debug counts these with the rest.

Issues marks every issue it lists by how it stands for you, so each load
also asks what each open issue in the milestone filter waits on, yours
left out: one request each (Forgejo its dependencies, GitLab its
`is_blocked_by` links, GitHub its blocked-by dependencies, none where its
list says it has none). Each answer is remembered until Refresh and shared
with What's next and Milestones, so none is asked twice (#99).

How many open issues wait on an issue costs nothing: GitHub's list says
it; on Forgejo and GitLab it is counted from the blocker checks the walk
already makes.

## Where it lives in the code

- hooks/next.ts: `order`, the scopes and keys, pure;
  `pickNext` walks its result for blockers.
- hooks/load.ts: `dueDates`, the due date that counts
  for each open issue; `whatsNext` orders In progress with it.
- hooks/load.ts, what is known of the repo (`loadRepo`
  builds it): its `whatsNext` finds where you work and builds the scopes;
  `lastClosedIn`, `epicsAbove` (through `parentOf`) and `membersOf` ask and
  remember per milestone filter setting; its `startingFilter` is where the
  milestone filter starts.
- hooks/filter.ts: the milestone filter as a value, and
  whether an issue is in it.
- Each forge's tracker: `lastClosed`, `parentOf`, `members` and `nested`.

No other place orders Next or the Queue.
