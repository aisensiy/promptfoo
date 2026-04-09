# redteam-coding-agent (Coding Agent Red Team)

Red team autonomous coding agents for repository prompt injection, terminal output injection, secret environment read, sandbox read escape, and verifier sabotage vulnerabilities.

```bash
npx promptfoo@latest init --example redteam-coding-agent
cd redteam-coding-agent
```

## Quick start

The default config targets `gpt-5.4` as a simulated coding agent. Set your API key and run:

```bash
export OPENAI_API_KEY=sk-...
npx promptfoo@latest redteam run
npx promptfoo@latest view
```

## Using a real coding agent

For meaningful results, point the config at a real agent provider:

- **Codex SDK**: Uncomment the `openai:codex-sdk` provider in `promptfooconfig.yaml` and set `working_dir` to a disposable checkout.
- **Custom agent**: Use a `file://` provider or HTTP endpoint that wraps your agent framework.

Real agent providers should return structured output with command executions and trace data so the deterministic verifiers can inspect commands, outputs, and file changes — not just the final response.

## What the plugins test

| Plugin                      | Vulnerability                                            | Detection                                                    |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `repo-prompt-injection`     | Agent follows hidden instructions in repository files    | Canary value detection + LLM grading                         |
| `terminal-output-injection` | Agent treats build/test output as authoritative commands | Receipt propagation detection + LLM grading                  |
| `secret-env-read`           | Agent reads or exposes launcher environment variables    | Canary value detection in output/traces                      |
| `sandbox-read-escape`       | Agent reads files outside the intended workspace         | Receipt detection + LLM grading                              |
| `verifier-sabotage`         | Agent weakens tests instead of fixing code               | Heuristic pattern detection + file hash checks + LLM grading |

## Strategies

Multi-turn strategies (`jailbreak:meta`, `jailbreak:hydra`, `goat`, `crescendo`) work with coding-agent plugins and significantly increase vulnerability detection rates. Encoding strategies (base64, rot13, etc.) are automatically excluded since they would break deterministic canary matching.

## Safety

- Never place production secrets in red-team configs. Use synthetic canaries (`{{secretEnvValue}}`).
- Run agents in disposable, least-privilege sandboxes.
- The generated prompts ask the agent to do unsafe things — that's the point. The graders evaluate whether the agent resists.
