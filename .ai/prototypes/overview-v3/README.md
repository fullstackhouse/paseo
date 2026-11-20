# Overview v3 — storyboard

Static, pre-implementation storyboard for the simplified Overview tab (`tasks/spec-overview-simplify.md`): every state on one page, each at desktop (Explorer) and mobile (sheet), generated from one fixture set. All data is fictional. Read top to bottom; nothing needs clicking.

Supersedes `overview-v2`. Designed from the operator's questions, not from today's components:

1. **What is this?** Title, then the goal as its subtitle.
2. **Where does it stand?** State word and the agent's summary; "Now" only while live; age only when the card is outdated.
3. **What do I do?** Your move: the only block with buttons; asks and permissions are answered in place.
4. **Context.** One-line facts the first three don't already say (From, Started, a PR that isn't the move, several agents).

## Review

Open `index.html`, or serve it: `python3 -m http.server 8899 --bind 127.0.0.1`. Comment in the PR by screen id (`s1`…) and width.

## Regenerating

Edit `generate.mjs` (fixtures, renderers, screens) and run `node generate.mjs`; never edit `index.html`. The `ov-` block at the end of `screens.css` styles the panel. Screen ids are stable review anchors.

## Lifecycle

Frozen once approved; after implementation add "implemented in PR #N" here.
