# Leaked-prompt regression fixtures

Real-world content that previous versions of this plugin captured as
"memories" when it should have stripped them as orchestrator scaffolding.
Each file is anonymized but otherwise verbatim from the wild — paths,
project names, and IDs have been replaced with placeholders.

Add a new file here when you discover a new scaffolding shape leaking
through. The regression test in
`tests/unit/leaked-prompt-fixtures.test.ts` walks this directory and
asserts that every fixture is:

1. Flagged by `isPolluted()`.
2. Reduced to an empty (or near-empty) `userText` by
   `createPromptBoundary()`.
3. Detected by the purge script's `POLLUTION_PATTERNS` so existing
   memories matching the shape can be cleaned up.

Naming: `<source>-<short-description>.txt` (e.g.
`sisyphus-f-task-brief.txt`, `prometheus-consultant.txt`).
