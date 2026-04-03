---
title: GPT-5.4 vs GPT-5.4 Mini MMLU-Pro Benchmark Comparison
description: Compare GPT-5.4 and GPT-5.4 Mini performance on MMLU-Pro reasoning tasks using promptfoo with step-by-step setup and deterministic scoring.
image: /img/docs/gpt-5-vs-gpt-5-mini-mmlu.png
keywords:
  [gpt-5.4, gpt-5.4-mini, mmlu-pro, benchmark, comparison, academic reasoning, openai, evaluation]
sidebar_label: GPT-5.4 vs GPT-5.4 Mini MMLU-Pro
slug: gpt-mmlu-comparison
---

# GPT-5.4 vs GPT-5.4 Mini: MMLU-Pro Benchmark Comparison

This guide compares GPT-5.4 and GPT-5.4 Mini on MMLU-Pro reasoning tasks using promptfoo.

**MMLU-Pro** is a harder successor to MMLU with more challenging reasoning questions and up to 10 answer options per item.

This guide shows you how to run MMLU-Pro benchmarks using promptfoo.

MMLU-Pro covers a broad set of academic and professional subjects, and it is more useful than classic MMLU when current models are already near saturation on easier multiple-choice benchmarks.

Running your own MMLU-Pro evaluation lets you compare reasoning quality, latency, and cost on a benchmark where full-size and mini models are less likely to tie at a perfect score.

:::tip Quick Start

```bash
npx promptfoo@latest init --example compare-gpt-mmlu-pro
```

:::

## Prerequisites

- [promptfoo CLI installed](/docs/installation)
- OpenAI API key (set as `OPENAI_API_KEY`)
- [Hugging Face token](https://huggingface.co/settings/tokens) (set as `HF_TOKEN`)

## Step 1: Basic Setup

Initialize and configure:

```bash
npx promptfoo@latest init gpt-5-mmlu-pro-comparison
cd gpt-5-mmlu-pro-comparison
export HF_TOKEN=your_token_here
```

Create a minimal configuration:

```yaml title="promptfooconfig.yaml"
# yaml-language-server: $schema=https://promptfoo.dev/config-schema.json
description: GPT-5.4 vs GPT-5.4 Mini MMLU-Pro comparison

prompts:
  - |
    Question: {{question}}

    {% for option in options -%}
    {{ "ABCDEFGHIJ"[loop.index0] }}) {{ option }}
    {% endfor %}

    End with: Therefore, the answer is <LETTER>.

providers:
  - openai:chat:gpt-5.4
  - openai:chat:gpt-5.4-mini

defaultTest:
  assert:
    - type: regex
      value: 'Therefore, the answer is [A-J]'
    - type: javascript
      value: |
        const match = String(output).match(/Therefore,\s*the\s*answer\s*is\s*([A-J])/i);
        return match?.[1]?.toUpperCase() === String(context.vars.answer).trim().toUpperCase();

tests:
  - huggingface://datasets/TIGER-Lab/MMLU-Pro?split=test&config=default&limit=20
```

## Step 2: Run and View Results

```bash
npx promptfoo@latest eval
npx promptfoo@latest view
```

You should see GPT-5.4 outperforming GPT-5.4 Mini on at least some MMLU-Pro categories, though the exact gap depends on the sample.

![GPT benchmark results](/img/docs/gpt-5-vs-gpt-5-mini-mmlu-results.jpg)

The results show side-by-side benchmark pass rates, letting you compare reasoning capabilities directly.

## Step 3: Improve with Chain-of-Thought

Add a short reasoning instruction and fixed final-answer format:

```yaml title="promptfooconfig.yaml"
prompts:
  - |
    You are an expert test taker. Solve this step by step.

    Question: {{question}}

    Options:
    {% for option in options -%}
    {{ "ABCDEFGHIJ"[loop.index0] }}) {{ option }}
    {% endfor %}

    Think through this step by step, then provide your final answer as "Therefore, the answer is A."

providers:
  - id: openai:chat:gpt-5.4
    config:
      temperature: 0.1
      max_tokens: 1200
  - id: openai:chat:gpt-5.4-mini
    config:
      temperature: 0.1
      max_tokens: 1200

defaultTest:
  assert:
    - type: latency
      threshold: 60000
    - type: regex
      value: 'Therefore, the answer is [A-J]'
    - type: javascript
      value: |
        const match = String(output).match(/Therefore,\s*the\s*answer\s*is\s*([A-J])/i);
        return match?.[1]?.toUpperCase() === String(context.vars.answer).trim().toUpperCase();

tests:
  - huggingface://datasets/TIGER-Lab/MMLU-Pro?split=test&config=default&limit=100
```

## Step 4: Scale Your Evaluation

Increase the sample size for a broader benchmark pass:

```yaml
tests:
  - huggingface://datasets/TIGER-Lab/MMLU-Pro?split=test&config=default&limit=200
```

## Understanding Your Results

### What to Look For

- **Accuracy**: GPT-5.4 may score higher across harder subjects
- **Reasoning Quality**: Look for stronger elimination among similar distractors
- **Format Compliance**: Better adherence to answer format
- **Consistency**: More reliable performance across question types

### Key Areas to Compare

When evaluating GPT-5.4 vs GPT-5.4 Mini on MMLU-Pro, look for differences in:

- **Mathematical Reasoning**: Algebra, calculus, and formal logic performance
- **Scientific Knowledge**: Chemistry, physics, and biology understanding
- **Chain-of-Thought**: Structured reasoning in complex multi-step problems
- **Error Reduction**: Calculation mistakes and logical fallacies
- **Context Retention**: Handling of lengthy academic passages and complex questions

## Next Steps

Ready to go deeper? Try these advanced techniques:

1. **Compare multiple prompting strategies** - Test few-shot vs zero-shot approaches
2. **Increase MMLU-Pro sample size** - Use larger random subsets once your prompt and assertions are stable
3. **Add domain-specific assertions** - Create custom metrics for your use cases
4. **Scale with distributed testing** - Run comprehensive benchmarks across all 57 MMLU subjects

## See Also

- [MMLU-Pro Dataset](https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro)
- [GPT vs Claude vs Gemini](/docs/guides/gpt-vs-claude-vs-gemini)
- [OpenAI Provider](/docs/providers/openai)
- [MMLU-Pro Research](https://arxiv.org/abs/2406.01574)
