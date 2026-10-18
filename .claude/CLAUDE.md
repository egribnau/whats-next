# What's Next: notes for working in this repo

What's Next, a Claude Code mod, published through the marketplace in
`.claude-plugin/marketplace.json`. The repo root is the plugin: users
install all of it.

## Read first

| When you | Read |
|---|---|
| add or change how a pane draws something (a view, a line, a count, a due date, a fold) | `docs/DRAWING.md`: a new view follows it, a change to a rule updates it |
| add or change how an issue is drawn (its mark, number, title, facts line, for-you line, a detail line naming one) | `docs/DRAWING-issue.md`, the same way |
| change how Next and the Queue are ordered, or where the milestone filter starts | `docs/ORDERING.md`, the same way |
| name a thing in a pane, the README, the canvas, an issue, a comment or code | `docs/TERMINOLOGY.md`: one word per thing |
| settle a drawing rule, an ordering rule or a word in a design review | the four above, and write the decision into the right one at once |
| add a token setting or a request, or show forge text in a new place | Testing and Hard rules below, and `tests/tokens.test.ts` |
| change the marketplace name | `docs/check-marketplace.sh` |
| retake the README screenshots, after a change that shows in them | `docs/shoot.py`: how to set it up and run it is at its top; the views and their settings are in #53 |

## Way of working

- One feature at a time, chosen by the maintainer.
- Design first, on the maintainer's design canvas: artboard titles say
  "(proposal)" or "(built, <version>)". Build only after the maintainer
  agrees; keep the canvas in step with the code.
- Work on a branch, never on main: main is mirrored to the public repo,
  which users install from. One branch per milestone, named after it in
  lower case (`r1.1`); the maintainer merges it to main when the milestone
  is done.
- A milestone is one release: on its branch, each change bumps a
  pre-release of the milestone's version in `.claude-plugin/plugin.json`
  (`1.1.0-pre.1`, `1.1.0-pre.2`); the last commit before the merge sets
  the release (`1.1.0`). Update the README when behaviour changes.
- Commit and push only when asked; the maintainer pushes.
- Commit messages carry no `Claude-Session:` line: the repo is mirrored
  publicly and those links open only for the maintainer.
  `Co-Authored-By:` stays.
- The repo is public: tests, docs, commit messages and the README name no
  real host, repo, person or path of the maintainer (use `git.example.org`,
  `boats/radar`, `alice`, `jdoe`). The only exceptions: the author name in
  the manifests, the copyright line, and the public repo and marketplace
  (`egribnau/whats-next`, `egribnau`), which users install from.
- No em-dashes in anything written; commas and periods instead.

## Testing

- `claude plugin test .`, `claude plugin validate --strict .`, `tsc` with
  the tsconfig from the types file header, `docs/check-tokens.sh` (every
  token setting is sensitive: the test sandbox cannot read the manifest)
  and `docs/check-marketplace.sh` (the marketplace name is written once,
  as `MARKETPLACE` in `hooks/forge.ts`, and matches the marketplace file).
- The engine lays no types in an installed plugin's folder, and the repo
  root is one: `tsc -p .` reads `.claude-plugin/types/claude-code/index.d.ts`,
  git-ignored, copied from Claude Code's own. After a Claude Code update,
  copy the newest `/tmp/claude-<uid>/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts`
  over it; its first line names the version that wrote it.
- Every file stays under 256 KiB, the most the plugin directory allows:
  `docs/shoot.py` shrinks each screenshot with pngquant.
- `tests/tokens.test.ts` shows a token never leaks: keep it passing, and give
  a new place that shows forge text, or a new request, a test there.
- `mock.clock(on)` is needed once the pane renders ages. `prompt.fill` hooks
  return `{ isFilled }` itself; ops like `process.run` and `http.fetch` return
  `{ value }`; a failing fetch is `{ deny: '...' }`. One `on(event)` per event
  per test.

## Engine facts that shaped the code

- Text inside a Button wraps instead of truncating: cut it with `fit()`.
- Once the pane has the keyboard, the arrow keys and Tab move between its
  controls, Enter presses the one in focus, and hotkeys press theirs.
- With a single pane the engine draws no tab title.
- A pane opened new comes in front of the others, asked or not; opening an
  open one again leaves the front as it was. Only `focus: true` brings an
  open pane in front, and it gives that pane the keyboard; while a pane holds
  the keyboard, a pane opened new stays behind it (#87).
- `claude plugin validate` scans each `update` and `read` for the atom it
  names: a literal, or a const of the same file. An atom passed in as a
  parameter fails validation, and with it every test (#94).
- The plugin directory reads `$` in a file that declares a hook in two
  forms only: a plain call, `$.noun.method(...)`, and `$` alone as an
  argument to a `function` declared at the top level of that same file
  (`read` and `update` from `claude-code` too). No arrow const, no
  function of another file: so the views take no `$`, `register.tsx`
  reads their state into `p.shown` and their writes are acts (#112).
  It reads `on` the same way: each registration a statement of its own,
  and no other name `on` in that file, not even a parameter.

## Hard rules

- Tokens come only from the token settings (Forgejo tokens, GitLab.com token,
  Private GitLab token, GitHub token): no environment variables, no files of
  other tools.
