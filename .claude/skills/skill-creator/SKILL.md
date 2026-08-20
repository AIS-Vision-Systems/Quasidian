---
name: skill-creator
description: How to add or edit a Claude Code skill, subagent or rule for the Quasidian repo. Use when asked to "create a skill", "add an agent", "capture this procedure", "make Claude remember how we do X", or when a procedure has been explained twice and should be written down.
---

# Creating skills and agents for Quasidian

## Pick the right home for the knowledge

| Kind of knowledge | Goes in | Why |
|---|---|---|
| An invariant that is always true | `CLAUDE.md` | Loaded every session, and re-injected after `/compact`. Costs tokens on every turn, so only rules that could be violated at any moment earn a line. |
| A constraint that only applies to one layer | a path-scoped rule in `.claude/rules/` | Loads when Claude reads a file the `paths` globs cover. Free until then. |
| A procedure with steps, run occasionally | a skill in `.claude/skills/` | Only the description is always loaded; the body loads when triggered. |
| A search, audit or extraction that would flood the main context | a subagent in `.claude/agents/` | Returns a conclusion instead of the files it read. |
| A one-off preference for this session | just say it | Not everything needs a file. |

If you are unsure between a rule and a skill: a rule is a *constraint*, a skill is a *recipe*. A rule fires because a file was opened; a skill fires because of what someone is trying to do. They overlap on purpose — the rule is the safety net for when the skill was never invoked.

## Rule anatomy

`.claude/rules/<kebab-name>.md`:

```markdown
---
paths:
  - "src/lib/**/*.ts"
---

# Title

The constraints, and why each one exists.
```

- `paths` is a **YAML list of quoted globs**, matched from the project root. Use `src/lib/**/*.ts`, not `src/lib/**` — `**` alone matches directories.
- **A rule with no `paths` loads every session**, exactly like `CLAUDE.md`. If you leave the frontmatter off by accident you have silently made the file always-on; that is the most common mistake.
- Path-scoped rules load when Claude **reads** a matching file. They are also *not* re-injected after `/compact` — they reload the next time a matching file is read. So a constraint that must never be forgotten belongs in `CLAUDE.md`, with the detail here.
- Keep the invariant in `CLAUDE.md` as one line and put the *how* and the *why* in the rule. Don't let the two contradict each other; if they do, Claude may pick either.

## Skill anatomy

`.claude/skills/<kebab-name>/SKILL.md`:

```markdown
---
name: kebab-name
description: What it does, then when to use it — written with the words a user would actually type. One or two sentences.
---

# Title

Body: the procedure, in the order it is performed.
```

Rules that matter:

- **The description is the only part always in context.** Write it for retrieval, not for elegance: name the artifacts (`t(key)`, `settings.json`, `tag_name`) and the phrasings that should trigger it. Keep it under about 40 words.
- **Body under ~80 lines.** If it grows past that, the skill is doing two jobs — split it, or move reference material to a sibling file and link it.
- **Name files and functions with real paths.** A skill that says "update the settings module" saves nothing; one that says `src/lib/settings.ts` saves an exploration.
- **Write in English**, like the rest of the repo's code and docs, even when the conversation is in Catalan.
- **State the failure mode.** The reason a rule exists is what makes it stick ("two CodeMirror copies on one page break the editor").
- Skills are invocable as `/kebab-name`, so pick a name a person would type.

## Agent anatomy

`.claude/agents/<kebab-name>.md`:

```markdown
---
name: kebab-name
description: What it does and when to delegate to it.
tools: Read, Grep, Glob
model: haiku
---
```

- **Restrict `tools`.** Read-only agents get `Read, Grep, Glob`. Only give `Edit`/`Write` to an agent that genuinely must change files.
- **Choose `model` deliberately** — `haiku` for extraction and lookup, `sonnet` for judgement. The point of an agent is to spend cheap tokens instead of expensive context.
- **Specify the output format explicitly**, and forbid what you don't want: an agent that isn't told "pointers only, no code blocks" will return the files it read and defeat its own purpose.

## After writing one

1. Check it against what already exists — extending a skill beats adding a near-duplicate. Current skills: `milestone-workflow`, `i18n-text`, `settings-option`, `markdown-editor`, `release-version`, `docs-sync`, `commit-pr`, `skill-creator`. Current agents: `spec-navigator`, `invariant-reviewer`, `code-locator`.
2. If it introduces a new slash command a person will use often, add it to the list at the end of `CLAUDE.md`.
3. Restart the session (or `/reload`) so the new skill or agent is registered.
4. Commit as `chore(claude): …`. `.claude/` is committed; only `.claude/settings.local.json` is gitignored. The repo is **public** — never put personal paths, machine names or credentials in these files.
