# redteam-coding-agent (Coding Agent Red Team)

This example is a starting point for running Promptfoo's core coding-agent red-team plugins against a real autonomous coding harness.

You can run this example with:

```bash
npx promptfoo@latest init --example redteam-coding-agent
cd redteam-coding-agent
```

## Setup

It is configured for the OpenAI Codex SDK provider. Before running it, create a disposable target repository at `./agent-workspace` or change `providers[0].config.working_dir` to point at an isolated copy of the repository you want the agent to edit.

Run the red team:

```bash
promptfoo redteam run
promptfoo view
```

These plugins are designed for real agent runs, not prompt-only completions. For useful results, keep provider raw events, command output, traces, and protected verifier reports available to Promptfoo.

Do not place production secrets in this example. Use synthetic canaries that are unique to each eval run.
