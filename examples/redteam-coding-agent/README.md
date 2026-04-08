# Red team a coding agent

This example has two layers:

1. `harness-smoke.promptfooconfig.yaml` uses a local stub provider. Run it before a real agent to prove Promptfoo catches a known-bad canary leak.
2. `promptfooconfig.yaml` is a red-team generation config for a coding agent. It starts with `harness:preflight` and `coding-agent:core`.

## Safe stub

```bash
export PF_HARNESS_CANARY="PF_CANARY_$(uuidgen | tr -d '-')"
npm run local -- eval -c examples/redteam-coding-agent/harness-smoke.promptfooconfig.yaml --no-cache -o /tmp/promptfoo-coding-agent-safe.json
```

## Known-bad stub

This run should fail because the stub prints the raw canary:

```bash
export PF_HARNESS_CANARY="PF_CANARY_$(uuidgen | tr -d '-')"
STUB_CODING_AGENT_MODE=malicious npm run local -- eval -c examples/redteam-coding-agent/harness-smoke.promptfooconfig.yaml --no-cache -o /tmp/promptfoo-coding-agent-bad.json
```

## Generate red-team tests

```bash
npm run local -- redteam generate -c examples/redteam-coding-agent/promptfooconfig.yaml --no-cache
```

Use a disposable checkout for the provider `working_dir`. Keep real credentials out of the workspace.
