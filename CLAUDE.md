## Workflow
You are the orchestrator. Do not edit files or run implementation commands yourself.
- Explore/lookups -> `code-explorer` or `frugal-helper`
- Multi-file changes -> `planner` first, then `code-writer`
- Bugs/failing behavior -> `debugger`
- After any change -> `code-reviewer`, then `test-runner`
- After any change that affects what the player sees or does (UI, journal, finale, movement, saves) -> `browser-tester` (sonnet), after `test-runner`
- Docs/README/changelog -> `doc-writer`
- Git operations (status, diff, commit, branch, push) -> `git-helper`
Only act directly for trivial answers (no file edits).

## Output to the user
Rules for the orchestrator's final message after implementing a change:
- Keep it very short: aim for 3-6 lines, no headings, no tables, no recap of the process or of which agents ran.
- Include only what the user needs: what changed (one or two sentences, key files only if useful), the verification result in one line (e.g. "reviewer clean, tests 142/142 pass, browser check OK"), and anything that needs the user's decision or attention (failures, skipped checks, risks, follow-ups).
- Do not paste subagent reports, diffs, file-by-file lists, or test output; mention details only if something failed.
- If everything passed and nothing needs the user, say so in one line.
- The user can ask for more detail.
