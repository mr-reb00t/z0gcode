# 0G Router models (verified live 2026-07-13)

`GET https://router-api.0g.ai/v1/models` returns 17 models: 15 chat, 1 image, 1 speech. All 15 chat models support tool calling. API compatibility: OpenAI for all, Anthropic for the 5 Claude models. Trust tiers: 0G native (Private, TeeML), Verifiable (TEE: TeeML or TeeTLS), and Open (proxied). `z0g models` renders this live catalog, grouped and priced.

## Full catalog (prices in USD per 1M tokens, live values)

| model | tier | ctx | max out | $in | $out | tools |
|---|---|---:|---:|---:|---:|:---:|
| **0gm-1.0-35b-a3b** | 0G native (priv) | 256K | 32K | 0.080 | 0.480 | yes |
| qwen3-vl-30b | verifiable | 256K | 32K | 0.019 | 0.189 | yes |
| deepseek-v4-flash | verifiable | 1M | 384K | 0.121 | 0.242 | yes |
| qwen3.7-plus | verifiable | 1M | 64K | 0.221 | 0.881 | yes |
| qwen3.6-plus | verifiable | 1M | 64K | 0.243 | 1.453 | yes |
| minimax-m3 | verifiable | 1M | 128K | 0.270 | 1.080 | yes |
| glm-5 | verifiable | 198K | 128K | 0.504 | 2.270 | yes |
| glm-5.1 | verifiable | 202K | 128K | 0.726 | 2.905 | yes |
| kimi-k2.7-code | verifiable | 256K | 16K | 0.787 | 3.268 | yes |
| qwen3.7-max | verifiable | 1M | 64K | 0.825 | 2.475 | yes |
| glm-5.2 | verifiable (priv) | 1.0M | 128K | 0.900 | 3.000 | yes |
| deepseek-v4-pro | verifiable | 1M | 384K | 1.452 | 2.905 | yes |
| claude-sonnet-5 | open (proxied) | 1M | 128K | 1.900 | 9.500 | yes |
| claude-opus-4-8 | open (proxied) | 1M | 128K | 4.500 | 22.50 | yes |
| claude-fable-5 | open (proxied) | 1M | 128K | 9.000 | 45.00 | yes |

Media models, priced per call (used by `z0g image` / `z0g transcribe`):

| model | kind | price |
|---|---|---|
| z-image-turbo | image | ~$0.04 per image |
| whisper-large-v3 | speech | ~$0.0000167 per second of audio |

Note: `glm-5.2` reports Private (TeeML) even though it sits in the Verifiable band, a real quirk `z0g models` surfaces with its trust dot.

## Model policy

- Primary: `0gm-1.0-35b-a3b` (0G's in-house coding model, Private + Verifiable). Thinking is on by default, so `max_tokens` covers reasoning + output: budget it high.
- Fallbacks: `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`.
- Do not hardcode the catalog: it changes. Read `/v1/models` at runtime and only send `tools` to models that advertise it (a model without tool support returns `400`). z0gcode does exactly this.
- Switch models any time with `z0g --model <id>` or the arrow-key `/model` picker (saved to `~/.z0gcode/settings.json`).
