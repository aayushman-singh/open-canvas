# Repository Instructions

## Subagent Workflow

- Use Cursor CLI for subagents only: `cursor agent`.
- Do not use Gemini CLI as a subagent runner unless explicitly requested.
- Keep subagent prompts scoped, self-contained, and file-backed when practical.
- Main agent remains responsible for reviewing subagent output, integrating edits, and running verification.
