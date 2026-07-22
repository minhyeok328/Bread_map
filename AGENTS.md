# Codex Project Instructions

## 1. Purpose and Priority

These instructions apply to Codex work in this repository.

The goal is to preserve reasoning quality and implementation capability while preventing token waste from duplicated context, redundant exploration, repeated reviews, and unnecessary Subagent coordination.

- Follow system, developer, and current user instructions before this file.
- Optimize for correct, complete, and verifiable outcomes, not minimum token usage alone.
- Do not omit necessary reasoning, safety checks, or verification to save tokens.
- Prefer focused, evidence-based work over broad speculative exploration.

## 2. Project Sources of Truth

- Start with `docs/README.md` to locate the authoritative product and technical documents.
- Use `docs/09-decisions/decision-log.md` for approved decisions and superseded alternatives.
- Keep each rule in its owning document. Do not duplicate product requirements in this file.
- When documents disagree, follow the owner identified by `docs/README.md` and report the conflict before implementing an ambiguous requirement.
- Do not silently change approved product scope, security boundaries, external-service policy, or acceptance criteria.

## 3. Work Hierarchy and Codex Task Boundaries

Use the hierarchy `Epic → Feature → Task`.

- **Epic:** A large objective containing multiple independently deliverable Features. Use an Epic task for planning, ordering, and decomposition; do not implement the entire Epic in one long task.
- **Feature:** An independently explainable and verifiable user or system outcome. Use a new Codex task for each Feature.
- **Task:** A concrete implementation, test, documentation, or verification step required by a Feature. Keep related Tasks in the same Feature task.

When work crosses into a new independent Feature:

- Recommend starting a new Codex task so unrelated context does not accumulate.
- Do not create a new Codex task unless the user explicitly requests it.
- Keep implementation and its direct verification in the same task until the Feature is complete.
- Do not split tightly coupled implementation, debugging, and verification merely to shorten context.

## 4. Main-Agent-First Execution

The main Codex agent is the default executor and owns final integration, verification, and reporting.

- Default to zero Subagents.
- A Task may be delegated; delegation is not automatic merely because a Task exists.
- The current Feature task may decide to use Subagents when the conditions below are satisfied.
- Do not use user-visible Codex tasks as substitutes for internal Subagents. New Codex tasks are for user-owned Feature boundaries.

## 5. Subagent Decision Rules

### 5.1 Limits

- Use no more than 2 Subagents per Feature task without explicit user approval.
- Do not allow a Subagent to create another Subagent.
- Reuse an existing Subagent for related follow-up work instead of spawning a replacement.
- Do not dispatch multiple Subagents to produce duplicate implementations or duplicate full-scope reviews.
- The main agent must review and integrate every Subagent result once.

### 5.2 Required Conditions

Use a Subagent only when all of the following are true:

1. The objective and completion criteria can be stated precisely in a short brief.
2. The work is independent of other active work or has a stable, explicit interface.
3. The result can be verified independently and integrated with limited additional context.
4. The expected benefit of parallel work or specialized review exceeds the briefing, execution, and integration cost.

Appropriate uses include independent modules with non-overlapping ownership, bounded research questions, and narrowly scoped high-risk reviews involving authentication, authorization, sensitive data, or data loss.

### 5.3 Prohibited Uses

Do not create a Subagent for:

- broad or undefined repository exploration;
- work the main agent can complete directly with little effort;
- sequential work blocked on another unfinished Task;
- simple status checks, formatting, linting, or a single test command;
- repeated review of unchanged code or documents;
- artificial decomposition whose primary effect is creating more agents;
- parallel work that reduces wall-clock time but increases total context and integration cost.

### 5.4 Minimal Context Brief

Do not provide a Subagent with the full conversation history. Prefer no history fork or the smallest recent-turn fork that is sufficient.

Provide only:

- objective and required deliverable;
- confirmed decisions;
- current status and remaining work;
- relevant files, symbols, and interfaces;
- constraints and areas that must not change;
- required verification and completion criteria.

If the brief cannot remain concise and self-contained, keep the work with the main agent.

## 6. Context and Inspection Discipline

- Retain only recent context and confirmed decisions relevant to the current Feature.
- Do not repeat research, exploration, or work that has already been completed.
- Narrow the scope first with file-name, text, symbol, error, and call-site searches.
- Prefer `rg` and `rg --files` for local discovery.
- Read only relevant files and log sections first; expand scope only for required context or impact analysis.
- Do not reread unchanged files without a specific reason.
- Inspect the working tree before edits and preserve unrelated user changes.
- When a new Epic or independent Feature begins, recommend a new Codex task.

## 7. Review and Verification

- Perform no more than one full-scope review by default.
- After changes, reverify the modified areas and their direct dependencies.
- Additional review is allowed for authentication, authorization, payments, deployments, sensitive data, destructive operations, and potential data loss.
- Use the smallest verification set that proves the relevant acceptance criteria, then expand only when risk or failures justify it.
- Do not claim completion until the relevant verification results are confirmed.
- Report checks that could not be run and explain the remaining risk.

## 8. Retry and Iteration Limits

- Do not enter an unlimited inspect → modify → recheck loop.
- If the same failure recurs, stop repeating the same approach and reassess the root cause.
- Do not retry without new evidence or a materially different approach.
- After a reasonable number of unsuccessful approaches, report the evidence, attempted solutions, current blocker, and remaining options.
- Ask for user input only when the missing decision cannot be discovered locally and a reasonable assumption would materially change the result.

## 9. Response Style

- Lead with the outcome.
- Report important changes, verification results, unresolved risks, and required user decisions concisely.
- Do not repeat the entire work process or previously reported findings.
- Keep commentary updates short and useful while work is ongoing.
- Include enough evidence for the user to verify the result without exposing unnecessary logs or internal reasoning.

## 10. Completion Checklist

Before reporting a Feature complete, confirm:

- the requested scope is implemented;
- unrelated user changes are preserved;
- relevant acceptance criteria are verified;
- Subagent results, if any, are integrated and reviewed;
- unresolved risks and unrun checks are disclosed;
- the final response is concise and outcome-focused.
