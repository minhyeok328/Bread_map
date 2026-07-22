# Codex Operating Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use Subagent-Driven Development because this change is small, sequential, and specifically defines Subagent limits.

**Goal:** Add a repository-root `AGENTS.md` that Codex automatically applies while working in Bread_map.

**Architecture:** Keep product requirements in the existing documentation hub and place only Codex execution policy in `AGENTS.md`. Use `Epic → Feature → Task` boundaries, make the main Codex agent the default executor, and allow at most two bounded Subagents per Feature thread without user approval.

**Tech Stack:** Codex repository instructions, Markdown, Git

## Global Constraints

- Target Codex only; do not describe generic GPT behavior.
- Create `AGENTS.md` at the repository root, not inside `.agents/`.
- Default to zero Subagents and prohibit recursive delegation.
- Do not reduce required analysis, safety checks, or verification to save tokens.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Add Codex Repository Instructions

**Files:**
- Create: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-22-agent-operating-rules-design.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: approved operating design in `docs/superpowers/specs/2026-07-22-agent-operating-rules-design.md`
- Produces: repository-wide Codex instructions automatically discovered from root `AGENTS.md`

- [x] **Step 1: Write the root instruction file**

Create `AGENTS.md` in English with these normative sections:

1. Purpose and priorities
2. Project source-of-truth links
3. `Epic → Feature → Task` definitions and Feature thread boundaries
4. Main-agent-first Subagent decision rules
5. Default zero, maximum two Subagents per Feature thread, no nesting, and agent reuse
6. Minimal Subagent brief fields and full-history prohibition
7. Narrow file/log inspection and no redundant rereads
8. One full-scope review by default, targeted reverification, high-risk exceptions
9. Retry limits and blocker reporting
10. Concise outcome-first responses

- [x] **Step 2: Make supporting documentation Codex-specific**

Rename the design title and hub link from “AI 에이전트” to “Codex” and state that the root file is the automatically discovered execution policy.

- [x] **Step 3: Verify instruction discovery and consistency**

Run:

```powershell
Test-Path -LiteralPath '.\AGENTS.md'
rg -n "Epic|Feature|Task|Subagent|maximum of 2|full conversation|verification" AGENTS.md
rg -n "AI 에이전트 운영 규칙" AGENTS.md docs/README.md docs/superpowers/specs/2026-07-22-agent-operating-rules-design.md
git diff --check
git status --short
```

Expected results:

- `Test-Path` returns `True`.
- Every required operating-rule concept is found in `AGENTS.md`.
- The old generic “AI 에이전트 운영 규칙” title has no matches.
- `git diff --check` reports no errors.
- Only `AGENTS.md` and the related design/index/plan documentation are changed or untracked.
