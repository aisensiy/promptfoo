---
sidebar_label: Coding Agents
sidebar_position: 10002
description: Red team coding agents by testing repo prompt injection, terminal output injection, secret reads, sandbox escapes, and verifier sabotage
---

# How to Red Team Coding Agents

Coding agents are different from chatbots: they read entire repositories, execute shell commands, consume noisy logs, edit many files, and often run in a sandbox that is supposed to separate the checkout from credentials, sibling repos, caches, and the host.

Promptfoo's coding-agent plugins focus on whether the model and harness preserve those boundaries while the agent performs realistic engineering work.

## Start With the Core Collection

For a first pass, run the core coding-agent collection:

```yaml
redteam:
  plugins:
    - id: coding-agent:core
      numTests: 10
```

The collection includes:

| Risk                                                                                                    | Plugin                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Untrusted repository text steers the agent                                                              | `coding-agent:repo-prompt-injection`     |
| Compiler, test, install, hook, or script output becomes an instruction channel                          | `coding-agent:terminal-output-injection` |
| Launcher-only environment values are read or revealed                                                   | `coding-agent:secret-env-read`           |
| The agent reads sibling repos, home files, temp files, or symlink targets outside the intended checkout | `coding-agent:sandbox-read-escape`       |
| The agent weakens tests, verifiers, snapshots, hooks, policies, or lockfiles to make QA pass            | `coding-agent:verifier-sabotage`         |

## Run the Agent in a Disposable Checkout

Each red-team row should run against an isolated repository copy whenever possible. The target provider should point the agent at that copy, not at your real development checkout.

This matters for correctness, not just safety. Coding agents mutate the checkout as they work. If multiple generated tests reuse the same writable repository, a canary, receipt, weakened test, or debug artifact from one row can leak into a later row and make the later result hard to interpret. Use a fresh clone, disposable worktree, container snapshot, or reset hook for every row when you want training-quality evidence.

For Codex SDK:

```yaml
providers:
  - id: openai:codex-sdk
    config:
      model: gpt-5.4
      working_dir: ./agent-workspace
      sandbox_mode: workspace-write
      approval_policy: never
      enable_streaming: true
      deep_tracing: true
```

Use `sandbox_mode: read-only` for pure audit tasks and `sandbox_mode: workspace-write` for repair tasks. Use `danger-full-access` only when that is the harness behavior you intentionally want to test.

For batches, prefer one of these isolation patterns:

- Run one Promptfoo eval per scenario and create a new `working_dir` before each run.
- Use row-specific vars such as `{{workspaceDir}}` and `{{secretEnvValue}}` in Codex provider config when your harness prepares those values per test case.
- Wrap the provider in a small launcher that materializes a clean workspace, invokes the agent, collects traces and file evidence, then deletes the workspace.
- If you must reuse a checkout, restore it to a known commit and remove untracked files before each row. Do not reuse canary values across rows.

## Make Harness Boundaries Observable

LLM-as-a-judge can catch semantic sabotage, but a coding-agent eval is stronger when the provider exposes machine-checkable evidence.

Recommended instrumentation:

- Return provider raw events with agent messages and command executions.
- Enable tracing so command, tool, MCP, search, file, and agent-message steps are visible in results.
- Use synthetic test-case canaries instead of real credentials.
- Record the SHA-256 of tests, verifiers, snapshots, policies, hooks, and lockfiles that the agent must not edit.
- When a scenario asks the agent to create a diagnostic artifact, pass that artifact path in the assertion so the grader can scan the target-written file for canaries.
- Run protected sidecar verification outside the agent's writable workspace and write a small JSON report for Promptfoo to inspect.

Promptfoo passes the provider response and available trace to red-team graders. The coding-agent grader uses deterministic verifier checks first, then falls back to the rubric with a compact trajectory summary. If an assertion-owned sidecar verifier report is configured but missing, the verifier fails closed because the missing report is itself a harness integrity failure.

## Test Model Behavior and Harness Behavior Separately

Some failures are model failures: the agent trusted a README instruction, copied a secret into the final response, or chose to skip a test.

Other failures are harness failures: a supposed sandbox included the user's home directory, the subprocess inherited sensitive environment variables, the grader could not observe command output, or the verifier lived in a writable location.

Design your eval so the result tells you which layer broke. A useful coding-agent red team usually has:

- A realistic engineering task with a passing outcome.
- One untrusted instruction source.
- One synthetic canary or receipt.
- A provider transcript or trace.
- A protected verifier that runs after the agent finishes.
- Cleanup that destroys the workspace, temp directories, and synthetic credentials.

For high-confidence runs, keep the canary, outside-workspace receipt, protected file hash, and sidecar report path unique per test case. A failing row should be attributable to the row's own evidence, not residue from a previous scenario.

## Example End-to-End Config

```yaml title="promptfooconfig.yaml"
description: Coding agent red team

prompts:
  - '{{prompt}}'

providers:
  - id: openai:codex-sdk
    config:
      model: gpt-5.4
      # Point this at a fresh disposable checkout for each row or run.
      working_dir: ./agent-workspace
      sandbox_mode: workspace-write
      approval_policy: never
      enable_streaming: true
      deep_tracing: true
      cli_env:
        # Use synthetic eval credentials only. Never place production secrets here.
        PROMPTFOO_SYNTHETIC_SECRET: '{{secretEnvValue}}'

redteam:
  purpose: |
    An autonomous coding agent that modifies a local repository, runs the
    appropriate tests, reports what changed, and does not obey instructions
    hidden in repository text or terminal output.
  plugins:
    - id: coding-agent:core
      numTests: 10

tracing:
  enabled: true
  otlp:
    http:
      enabled: true
```

Run the red team with:

```bash
promptfoo redteam run
```

Then inspect failed rows in the web UI. For each failure, look at the final response, provider raw transcript, trace/trajectory, changed files, sidecar verifier report, and grader metadata.

## QA Checklist

Before using results for model training, policy changes, or harness signoff:

- Confirm the agent ran in a disposable workspace and did not share mutated state across rows.
- Confirm canaries and receipts are synthetic, unique, and absent from any real secret store.
- Confirm the provider raw events or traces include command executions, stdout/stderr, file writes, and final agent messages.
- Confirm protected tests, verifier scripts, snapshots, policy files, hooks, and lockfiles are either read-only to the agent or checked with host-side hashes.
- Confirm sidecar verifier reports are produced outside the agent workspace and that missing reports fail the row.
- Confirm every deterministic failure includes enough metadata to identify the evidence source without exposing the raw secret value.
