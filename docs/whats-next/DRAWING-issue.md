# What's Next: drawing an issue

How What's Next draws an issue wherever a pane shows one: a row, the lines
under it, and the lines of a detail that name one. The rules every view
shares (colours, counts, rules, due dates, rows that fold, lines with
several parts) are in DRAWING.md; the words are in TERMINOLOGY.md. A new
view follows these rules; a change to a rule changes every place it lists.

Each item names what draws it. Those helpers are in
plugins/whats-next/hooks/draw.tsx unless named otherwise, and no other
place builds that text or colour; they read nothing but the look and their
arguments (DRAWING.md says what the look holds).

## Marks

The first two columns of an issue row say how it stands for you, the
same in every pane. The shape says whether the row folds, the colour how
it stands for you: green is for yours alone (#45, built 0.65.0).

| State | Doesn't fold | Folded | Unfolded | Also said by |
|---|---|---|---|---|
| yours | `●` green | `⊕` green | `⊖` green | |
| blocked | `⊘` dim, title dim | `⊕` dim, title dim | `⊖` dim, title dim | the facts line, `⊘ n` |
| with others | `◌` plain | `⊕` plain | `⊖` plain | their name, dim, at the right of the title line |
| available | `○` plain | `⊕` plain | `⊖` plain | on a row that folds: no name at the right |
| shown above | | `↑` dim, not a target | | its second line, `shown above` |

The number stays blue whatever the mark. Yours wins over blocked; blocked
wins over with others, whose name still shows at the right. What's next
shows no `◌`: it leaves issues with others out. Next and the Queue show
`○`, as available does everywhere; Next is also bold. Nothing has the
focus when the pane opens, Next neither: an inverted bold row was too
heavy (#57, built 0.67.0).

This table is for an issue row. Where the fold mark sits, what it folds,
and the fold marks of epics and milestones at the top and of section rules:
DRAWING.md, Rows that fold.

A new mark fits this meaning, is one cell of plain Unicode (no Nerd Font,
so it shows with Icons off), differs from the others by shape and not only
colour, and takes a place in the order. Due dates and news belong in the
facts line or the title, never in the mark.

Drawn by: `markOf` (plugins/whats-next/hooks/epics.ts) picks the glyph and
colour from `standing` and the fold; `markText` draws it; `whoOf` names whom
it is with.

| Where | Marks |
|---|---|
| What's next, In progress | `●` |
| What's next, Next and the Queue | `○` |
| What's next, the blocked at the end of the Queue | `⊘` |
| Epics, a child | `●` `⊘` `◌` `○`, or `⊕`/`⊖` coloured so when it has children |
| Milestones and its detail, an issue under a milestone or an epic | the same |
| Issue detail, the heading and Blocked by | the same, `✓` when closed (#72, built 0.69.0) |
| Issue detail, Blocks | `⊘`, or `●` when yours; `✓` when closed (#72, built 0.69.0) |
| Issue detail, Epic | the same, its children not counted as what blocks it; `✓` when closed (#72, built 0.69.0) |
| Issue detail, Children | the same for each open child; the closed ones one grey line, `✓ 3 closed` (#86, built 0.73.0) |

## Number and title

The number comes first, always as `#n`, in a column as wide as the
longest number in the list and one space; numbers sit at its right so
their last digits line up, and titles start in one column. Every row and
every tree in one pane shares that column. Blue unless the issue is
closed, then grey.

A title on a row or a line is cut with `…` to the room left (`fit`),
never wrapped: text in a button wraps. A detail's heading is the one
exception: it wraps over at most two lines, and a longer title ends the
second in `…`. Bold for Next, and for an epic at the top of a tree.

A closed issue's or milestone's heading is grey as a whole, number and
title, both lines when it wraps, still bold (#45, built 0.65.0).

Drawn by: `numberText` in every list and tree; `closedRow` for a closed
epic; the detail lines and the heading keep their own, as each is the only
place of its kind.

| Where | Number column | Title |
|---|---|---|
| What's next | one for all sections | bold for Next |
| Epics | one for every group and tree | bold for an epic |
| Milestones | one for every milestone folded open | bold for an epic |
| Milestone detail, Issues | one for the tree | bold for an epic |
| Issue detail, heading | the mark, then `#n` blue; the heading grey as a whole once closed | wraps over two lines |
| Issue detail, Epic, Children, Blocked by, Blocks, Pull requests | one for them all, see Detail lines | cut |

## The facts line

One line under an issue row, starting under its title: a recipe of
blocks, left to right. A block shows only when its condition holds; the
blocks that show are joined by ` · `, dim, in one text cut once at its end.

| # | Block | Shown when | Drawn as |
|---|---|---|---|
| 0 | shown above | the issue is already in the tree higher up | `shown above`, dim; the line is this alone |
| 1 | blocked by | it stands blocked: open blockers, and not yours | `⊘ 2`: how many open issues block it, the mark and the count dim, as unblocks; which ones, the issue detail's Blocked by (#73, built 0.71.0; 0.66.0 to 0.70.2 drew the numbers, `⊘ #24, #22`) |
| 1b | unblocks | open issues wait on it, as far as is known (GitHub's lists count them; on Forgejo and GitLab what the blocker checks found), its own epic left out as in the detail (#62, built 0.68.0, decided 3c) | `↦ 2`: the bar is this issue, the arrow what it opens; dim, a count, never the numbers (#57, built 0.67.0) |
| 2 | due date | it has one (Forgejo and GitLab send it with the lists; GitHub issues have none), or its epic's is the due date that counts | `⧗ 14 Oct`, short form, red once passed, amber within 7 days, dim otherwise (DRAWING.md, Due dates; #45, built 0.66.0). The due date that counts (ORDERING.md, Due soon), when it is due soon and not its own, is shown with whose it is: its epic's `#30 ⧗ 19 Oct`, the number blue, in this place; its milestone's after the milestone's name (3). Its own later date is then only in the detail: one due date on a line (#70) |
| 3 | milestone | it has one, and the list is not that milestone's (the milestone filter is set to it, or the row is under it) | `v0.3.0`, dim; `v0.3.0 ⧗ 20 Oct` when the milestone's due date is the one that counts and due soon (#70) |
| 4 | labels | it has any | each in its colour, commas dim |
| 5 | age | it is known (a row made from a reference may not have it) | `✎ 3d`: the pencil (U+270E, one cell), how long ago it was opened, dim (#45, built 0.66.0) |

Not on the line: when it was updated, how many comments; the detail
shows both (#45). What blocks the issue and what it blocks are only
counted here, `⊘ 2` and `↦ 2`, one way for both (#57, built 0.67.0; #73,
built 0.71.0); which issues those are is for the issue detail, #62.
The epic an issue is in is not on the line: where it says why a row
is where it is, the rule says it (DRAWING.md, Rules). Whom it is with
is at the right of the title line, not here. They are not buttons: the
row opens its own issue. Compact drops the empty line between rows, not
the one that ends a section (DRAWING.md, Rules).

An age is minutes, hours, days, weeks, months or years (`5m`, `3h`, `6d`,
`3w`, `4mo`, `2y`), from `age`: on the facts line after `✎`, elsewhere
followed by `ago`.

Drawn by: `issueRow`, its parts through `partsLine`; the due date by `duePart`; labels by `labelTexts`; unblocks from `waiting`, which reads the look's unblocks, What's next's count, so a pane knows it as far as What's next does.

| Where | Drawn as |
|---|---|
| What's next, every row | blocked by, unblocks, due date, milestone (not when the milestone filter is set to one), labels, age |
| Epics, a child | the same |
| Milestones, an issue under a milestone | blocked by, unblocks, due date, labels, age |
| An epic at the top of a tree: Epics, Milestones, the milestone detail | the same as the place's issue rows, folded or unfolded: blocked by (its own children left out), unblocks, due date, milestone (Epics with the filter on All), labels, the Epic label too, age (#64, built 0.72.0) |
| Issue detail, under the heading | not the facts line: one line of its own, see The issue detail's heading |

## The for-you line

What there is for you among some open issues, parts joined by ` · `,
from `forYou`: signs, not words (#45, built 0.66.0). Each part is the
mark (Marks) then its count, `● 2` green, the others dim. The parts come
in the order the rows are listed: yours, available, with others, blocked,
`● 2 · ○ 2 · ◌ 3 · ⊘ 1`. A part with nothing in it is left out; with
nothing at all, no line. With others shows whenever any issue is with
others. The lines that stand alone (`children unknown`, `no children`,
`all closed`, `issues unknown`) stay words: there is no count to put a
sign before.

An epic is an issue, so its row has the facts line any issue row has,
folded or unfolded, its due date there; folded, the for-you line comes
under it, the counts alone (#64, built 0.72.0). One epic is drawn so in
Epics, in Milestones and in the milestone detail (#64, built 0.72.0).

The line under a milestone (#45, built 0.66.0):

| # | Block | Shown when | Drawn as |
|---|---|---|---|
| 1 | due date | it has one | `⧗ 14 Oct`, short form, red, amber or dim |
| 2 | for you | any of it is known | `● 2 · ○ 2 · ◌ 3 · ⊘ 1`; or `all closed`, amber; or alone `issues unknown` |

A milestone without a due date says nothing of it there; how many of its
issues are open is read from its count. Folded, a milestone whose issues
could not be listed says `issues unknown`; folded open, the list under it
says so.

Under a folded epic, the for-you line is block 2 alone, after its facts
line, and starts with the word `children`, dim: `children ● 1 · ⊘ 2`.
The facts line's `⊘ 2` is what the epic itself waits on; without the
word, the `⊘ 2` of its blocked children under it read as the same thing
(#64, built 0.72.0, decided 5). `no children` and `children unknown`
say it already and get no word before them. Where all its children are
closed: `children all closed`,
amber, as for every epic or milestone still open (DRAWING.md, Counts and
states; #45, built 0.65.0). With no children, `no children`; not known,
`children unknown` (`summary`). In Epics, a children request that fails
leaves only that epic's children unknown, folded and open; the other epics
draw as they are, as in a milestone and under a row (#88, built 0.75.0,
decided 1).

Drawn by: `forYou` and `summary` (plugins/whats-next/hooks/epics.ts) say
what, `duePart` the due date before it; `partsLine` draws it, one text.

| Where | Counts |
|---|---|
| Epics, under a folded epic | its children, after the word `children` |
| Milestones and its detail, under an epic, folded | its children, after the word `children` |
| Milestones, under a milestone | its issues that are not epics, as far as the pane knows them without asking (only `● n` until every issue not yours was checked) |
| Milestone detail, under the bar | its issues that are not epics |

## The issue detail's heading

The title, with its mark in front of the number as the lists draw it
(Marks), then one line under it: who opened it and when, as the facts line
says it. A closed issue's mark is `✓`, the heading grey as a whole. No
state word: `open` is said by the mark, as everywhere else (#72, built 0.69.0; 0.68.8
had `open` or `closed` before the opened block, #62 decided 1a which blocks
go on the line, not that the state is a word).

| # | Block | Shown when | Drawn as |
|---|---|---|---|
| 0 | mark | always, before the number | `●` `⊘` `◌` `○` as Marks, an epic too, its own children not counted as what blocks it; `✓` grey when closed (#72, built 0.69.0) |
| 1 | opened | always | `✎ 3w jdoe`: the pencil, the age, who opened it; dim |

Not on the line: the milestone, which is a fact under its name,
`Milestone  v0.3.0 · ⧗ 30 Oct`, its due date after it (Detail lines), so
`⧗` there is never the issue's own; how many comments, which the rule of
the comments counts; when it was updated, which the newest comment shows.

The milestone detail's heading reads the same: an open milestone has no
mark and no line under its title; a closed one is `✓` before its title,
grey, and under it when it closed (`3 days ago`) where the forge says
(#72, built 0.69.0; 0.68.8 had `open`, or `closed 3 days ago`). Its due date is a
fact under the key `Due`, in the same 11-column gutter (#62, built 0.68.0,
decided 6). A milestone has no author, so no `✎`.

## The issue detail's comments

Under the rule `− Comments · 3`, which folds the section, the newest
comment first and unfolded: its line `− jdoe · 2d ago` (the name bold,
the age dim), then its text, 3 lines and `… n more lines` from 5 lines on, as
Description. Each older one, newest to oldest, is one line,
`+ jdoe · 5d ago · its first words…`, dim but for the name, bold, cut once at its end; pressing it
unfolds that comment. The newest is so always right under the rule, and
no older comment pushes it away (#62, built 0.68.0, decided 4b). No comments:
no rule.

`… n more lines` under a comment is a dim button: pressed, the rest of
that comment shows, until the issue opens again. Under Description, in
the issue detail and the milestone detail alike, it is the same button,
and unfolds Description as its rule does (#62, built 0.68.7). Pressing an unfolded
comment's line folds it. Where the forge would not list the comments,
`comments unknown`, dim, under the rule (#62, built 0.68.0).

Drawn by: `issueView` (hooks/views/issue.tsx), the rule by `rule`.

## Detail lines that name an issue

Epic (or Parent), Children, Blocked by, Blocks and Pull requests in the
issue detail: one line each,
`● #n title`, under a dim key in an 11-column gutter, the key on the
first line of its group only, as every key of the detail. The keys are
words, as GitHub and GitLab have them: `Blocked by`, `Blocks`, the longest
key, 10 columns, setting the gutter (#62, built 0.68.0, decided 2; signs as
keys were tried and dropped, half signs and half words read badly).
Pull requests are under the forge's word:
`PRs` on Forgejo and GitHub, `MRs` on GitLab, where the number is `!61`
and not `#61`, which there is an issue (#62, built 0.68.0, decided 3d).
Under Blocks the issue's own epic is left out: on Forgejo an epic depends on
its children, so it waits on each of them, but it is already the `Epic`
line (#62, built 0.68.0, decided 3c). One number
column for them all, as wide as the longest number there, numbers at its
right, so the titles start in one column. An issue's line has its mark
before the number, as the lists draw it (Marks), and no state word: the
mark says it (#72, built 0.69.0; 0.68.8 had `open` and `blocked` at the right, and
a red number for Blocked by).

| Line | Mark | Number | At the right |
|---|---|---|---|
| Epic, open | `●` `⊘` `◌` `○` as Marks, as its own heading: its children not counted as what blocks it | blue | with others, or blocked and held by someone: their name, dim; then `→`, which opens it (#74) |
| Children, open | `●` `⊘` `◌` `○` as Marks; blocked dims the mark and title | blue | with others, or blocked and held by someone: their name, dim |
| Children, closed | none: one grey line for them all, `✓ 3 closed`, in the mark column, as under an unfolded epic in the lists (DRAWING.md, Counts and states) | | nothing |
| Blocked by, open | `●` `⊘` `◌` `○` as Marks; blocked dims the mark and title | blue, as everywhere: the key says it holds this one up | with others, or blocked and held by someone: their name, dim |
| Blocks, open | while this issue is open, `⊘`, mark and title dim: it waits on this issue, so it stands blocked; `●` green when it is yours (yours wins over blocked). Once this issue is closed, asked as a blocker is: `●` `⊘` `◌` `○` | blue | someone holds it: their name, dim |
| Pull request, open | none: marks are for issues | blue | nothing |
| Pull request, merged | none | blue | `merged` purple |
| any, closed | `✓`, the whole line grey, no strikethrough | grey | nothing |

Children, Blocked by and Blocks lines are plain buttons: the focus inverts them,
Enter opens that issue in the same pane, and Back returns. Pull request
lines are not buttons. An Epic (or Parent) line is a plain button that
opens the epic list where the token may write, and plain text where it
may not; its `→` at the right is a button of its own that opens the
epic, so the line looks the same either way, and Tab stops on the line,
then on `→` (#74, decided 1B-i and 6b).

The facts of the issue detail, top to bottom, in the facts line's order
and then what only the detail has: Epic (or Parent), Children, Blocked by, Blocks,
Due, Milestone, Labels, then Branch, Time, PRs (or MRs), Commits. How old
it is is on the line under the title (#62, built 0.68.0, decided 3a).

First among the facts, the issues it is a child of, if any: one line
each, drawn as a Blocked by line, number blue, under the key `Epic`, or
`Parent` when it is not an epic (on GitHub any issue can be a parent)
(#62, built 0.68.0, decided 3b). On Forgejo and GitLab an issue can be
under several epics, each a line, the key on the first only, in the epic
list's order; on GitHub it has one parent at most (#74, decided 3A). On
Forgejo and GitLab an epic has none: an epic that depends on it waits
for it, as in Epics, so it is under Blocks (0.74.3).

Then its children, under the key `Children`, on every forge: an epic's on
Forgejo (the issues it depends on) and GitLab (the issues it links as
related), other epics left out as TERMINOLOGY.md says; on GitHub the
sub-issues of any issue that has them. The open ones in the order the
forge gives them, each a line drawn and pressed as a Blocked by line;
the closed ones counted on one grey line, `✓ 3 closed`, not buttons.
Up, then down, then what it waits on (#86, built 0.73.0, decided 1 and
2). No children, or the forge would not say: no Children key.

Blocked by then holds only what it waits on outside its children: on
Forgejo an epic depends on each child, and those are its Children lines,
not what blocks it, as its mark and the facts line's `⊘ n` already count
it (#64). Another epic it depends on stays under Blocked by. All its
blockers its children: no Blocked by key (#86, built 0.73.0, decided 3).

The other lines of a detail: Due (long form), Branch plain, Time,
Labels, Commits (sha dim, message cut, age dim at the right; three at
most). A line the forge would not answer for is left out, as is an empty
one, but Labels where the token may change them: there it is a plain
button, as an Epic line, that opens the labels list, and with no labels
it reads `none`, dim, so there is something to press (#66, decided 1D).
Labels past the line go on to the next, under the value, as Children: a
line ends in a comma where more follow, a label is never split (one longer
than the line is cut), and each line opens the labels list (#74, decided
10b).
Milestone the same, where the token may change it: a plain button that
opens the milestone list, `none`, dim, without one (#68). Epic the same:
an issue without a parent has `Epic  none`, on GitHub `Parent  none`,
dim, a plain button that opens the epic list, where the token may write;
not on an epic on Forgejo and GitLab, which has no parent there (#74,
decided 1B and 5a-i).

Drawn by: `refLine`, under its key by `keyed`, in `issueView` (hooks/views/issue.tsx).

## The labels list

From the issue detail, a label is added or taken off in the labels list
(#66). It opens from Labels in the menu (hotkey `l`) and from the Labels
line, both only where the token may write, as Assign Me and Close (decided
1A and 1D). It opens over the rows as the menu does, in a dim frame at the
right (DRAWING.md, The menu), but its frame starts on the Labels line's
row, its first line under it, as the detail is scrolled; where it does not fit there it
moves up as far as it must, to under the top row at most, and the Labels
line scrolled out of view starts it there too. Opening it shuts the menu
and the milestone filter's list. Its first line is `Labels`, dim, and at its right `✕`, a
button that shuts it, as the cross that closes a pane; that line stays
when the labels scroll. `l` again, the Labels line again or `☰` shut it
too.

Its lines are the repo's labels, on GitLab its groups' too, by name, each
in its colour as everywhere (Colours, DRAWING.md), after a box: `☑` on the
issue, `☐` not (decided 2i). Each line is a plain button: Enter adds that
label or takes it off at once, and the list stays open for the next
(decided 3a). The Labels line and the lists show the change at once, as
after Assign Me and Close; taking `epic` off makes the issue no epic there.
A list longer than the pane is cut to it, and the focus scrolls it, as a
detail scrolls. Until the forge answers it reads `Loading …`; a repo with
none, `No labels in boats/radar.`, dim; a list the forge refused, why, red.

A refusal is red under the heading, where Assign's and Close's go: `Could
not add bug to #29: 403 Forbidden.` (decided 4). A press ticks or unticks
its box at once, the Labels line following, as the epic list does; refused,
the box goes back as it was.

Until the forge answers a press, the list waits: a spinner turns in the
middle of its first line (`Epic      ⠹      ✕`, the frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`,
dim), in the gap between the name and `✕` where the name reaches the
middle (`Labels ⠹ ✕`); the name stays at the left. Its lines are dim and
take no press; no words say what it does, and a refusal is red under the
heading as ever. The list never changes width: the narrowest labels list
is 10 columns, room for the gap. Once the forge answers, the spinner stops
and the lines come back, while the lists are read again after it (#74,
decided 8c-a and 9C; 8A's words were dropped, they made a narrow list
wider; a name centered was not wanted). The milestone list and the epic
list wait the same; the milestone list, which shuts on a press, spins
on the Milestone line instead, before its value.

The boxes are on the help page, under Buttons.

Typing to narrow the list, as the forges do, is for later (2iv on the
canvas).

Drawn by: `labelsList` in `issueView` (hooks/views/issue.tsx), in the
frame's `overlay`.

## The milestone list

From the issue detail, the issue is moved to another milestone, or out of
its own, in the milestone list (#68). It opens from Milestone in the menu
(hotkey `m`, as the milestone filter's in a list) and from the Milestone
line, both only where the token may write, and is drawn, placed, scrolled
and shut as the labels list: its frame on the Milestone line's row, its
first line `Milestone`, dim, and `✕`; `m` again, the Milestone line again
or `☰` shut it too. Opening it shuts the menu and the labels list, and the
other way round.

Its lines are drawn as the milestone filter's list (decided 2i):
`No milestone` first, as the epic list's `No epic` (#74, decided 7; the
milestone filter keeps `None` last, as it is a filter), then the open
milestones in the filter's order, due first (ORDERING.md), on GitLab a
parent group's too; each name padded to a column, its
due date in the short form after it, no `⧗` (DRAWING.md, Due dates). The
issue's own is bold; an issue in a closed milestone has that one first,
grey and bold, its date dim. Each line is a plain button: Enter moves the
issue there at once and shuts the list, and the pane stays on the issue
(decided 3a); Enter on the issue's own only shuts it. Until the forge
answers, a spinner turns on the Milestone line before its value, as the
labels list waits (#74, decided 8c-a); the value is the new milestone from
the press on, as the labels list ticks at once, and the old one again when
the forge refuses. What's next, Epics and Milestones show the change once
the forge has made it, the milestone counts following, as after Assign Me
and Close. The open milestones are
known already, so opening it asks nothing; until they are, it reads
`Loading …`. A milestone list the forge refused is no list: only
`No milestone`.

An issue with open children in its own milestone (an epic's, or on
GitHub its sub-issues) has `☑ Children too` first, before `No milestone`,
the count of those children at the right, and a dim rule under it. It is a plain button: a
press ticks or unticks it and the list stays open. Ticked, a move takes
those children along, to the same milestone or out of it; closed children
and those in another milestone stay. It starts ticked, and the choice is
kept until Refresh (#68, decided A, ticked).

A refusal is red under the heading: `Could not move #29 to v1.2: 403
Forbidden.`, `Could not take #29 out of v1.1: 403 Forbidden.` The issue
refused, no child is tried; a child refused, the rest still move, and the
refusal says so: `Moved #29 to v1.2; could not move #31: 403 Forbidden.`

Drawn by: `milestoneList` in `issueView` (hooks/views/issue.tsx), in the
frame's `overlay`.

## The epic list

From the issue detail, the issue is put under an epic, or taken out of
one, in the epic list; on GitHub it is the parent list (#74). It opens
from Epic in the menu (hotkey `e`, after Milestone; `Parent` on GitHub)
and from the Epic (or Parent) line, `none` too, both only where the
token may write, and is drawn, placed, scrolled and shut as the labels
list: its frame on the first Epic line's row, its first line `Epic`
(`Parent` on GitHub), dim, and `✕`; `e` again, the line again or `☰`
shut it too. Opening it shuts the menu, the labels list and the
milestone list, and the other way round (decided 1B, 5a-i).

Its first line is `No epic` (`No parent` on GitHub), a plain button
that takes the issue out of every epic it is under (decided 2a-i). Then
the open epics in the Epics pane's order: by milestone, due first, then
those without one (ORDERING.md), the issue itself left out. Each line
is drawn as a detail line naming an issue (Detail lines that name an
issue): its mark, number and title, after a box, `☑` the issue is under
it, `☐` not (decided 2a-i, 3A). No milestone names the groups.

On GitHub, where any issue can be a parent, the open issues of the
issue's own milestone follow, under a dim rule naming it,
`──── v1.1 ────`, the epics and the issue's own children left out, so
there is no loop; an issue without a milestone has the epics alone, as
those without one can be thousands (decided 2b-ii). A parent in neither
comes first after `No parent`, ticked. Every open issue, through a
search, is for later (#102).

Each line is a plain button: Enter ticks it or unticks it at once, and
the list stays open, as the labels list (decided 3A). The tick moves before
the forge answers, and goes back if it refuses. Until it answers the list
waits as the labels list does, its spinner turning (decided 8c-a): a press
then is passed over, as the ticks it saw may be about to change, but not
while the lists are read again after it.
What the forge took counts for 30 seconds over what it answers, as
GitHub answers the old parent for a while. On Forgejo and
GitLab an issue can be under several epics; on GitHub it has one parent,
so ticking another moves it and unticks the old. Only the parent
changes: the issue keeps its milestone, which the Milestone line changes
(decided 4a). The Epic lines, What's next, Epics and Milestones show the
change at once, as after Labels. The epic's own text, such as a list of
its children in its description, is left alone. The open epics, and on
GitHub the open issues of the milestone, are known already from the
lists; opening it asks only what a mark still needs (what an epic waits
on), `Loading …` until then. Epics the forge would not list are no list:
only `No epic`.

On the forge it is: on Forgejo a dependency added to the epic or taken
off it (the epic depends on its children); on GitLab a related link
added or taken away (it has no direction); on GitHub the issue made a
sub-issue of the parent, or taken out of it, by the issue's id, which is
asked first.

A refusal is red under the heading, in the words put under and take out
of (decided 5b-i): `Could not put #29 under #12: 403 Forbidden.`,
`Could not take #29 out of #12: 403 Forbidden.` On GitHub a move is one
request, which takes the issue out of its old parent too; `No epic` with
several to take out of stops at the first refused. A refusal, here as after
any action of the detail, stays until the next action or Refresh, even
when an earlier press finishes after it.

Drawn by: `epicList` in `issueView` (hooks/views/issue.tsx), in the
frame's `overlay`.
