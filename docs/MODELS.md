# 0G Router models (verified live 2026-07-11)

`GET https://router-api.0g.ai/v1/models` returns 17 models: 15 chat, 1 image, 1 speech. 15 support tool calling. API compatibility: OpenAI for all, Anthropic for the 5 Claude models. Trust: Verified (TeeML + TeeTLS) or Private (TeeML).

## Coding / tool-use models (z0gcode candidates)

| id | tools | ctx | notes |
|---|:---:|---:|---|
| **0gm-1.0-35b-a3b** | yes | 262K | **0G in-house, agentic coding + tool use, Private (TeeML) + Verifiable, cheap. z0gcode default.** |
| deepseek-v4-pro | yes | 1M | DeepSeek flagship for agentic coding and multi-step workflows |
| glm-5.2 | yes | 1M | open-source flagship, 1M lossless context, strong coding |
| kimi-k2.7-code | yes | 262K | Moonshot coding model, agentic coding + tool use |
| minimax-m3 | yes | 1M | frontier multimodal, native tool use, long-horizon |
| qwen3.7-max / qwen3.7-plus / qwen3.6-plus | yes | 1M | Qwen flagships, native function calling |
| claude-fable-5 / opus-4-8 / sonnet-5 | yes | 1M | Anthropic models on 0G (also Anthropic-compatible endpoint) |

Avoid as a coder: `qwen3-vl-30b` (vision), `whisper-large-v3` (speech), `z-image-turbo` (image).

## Model policy
- Primary: `0gm-1.0-35b-a3b`. Thinking is on by default, so `max_tokens` covers reasoning + output: budget it high.
- Fallbacks: `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`.
- Do not hardcode the catalog: it changes. Read `/v1/models` at runtime and only send `tools` to models that advertise it (a model without tool support returns `400`).
