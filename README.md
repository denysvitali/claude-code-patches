# claude-code-patches

CPU optimization patches for Claude Code CLI that reduce CPU usage through runtime patching.

> [!NOTE]
> v2.1.29 patches were vibe coded w/ Kimi K2.5.
> v2.1.45 patches (analysis + fixes) were created with Claude Sonnet 4.6.
> Tested on my machine — it might be placebo.
> Use at your own risk and tell me what you think!

## Overview

This project applies targeted performance patches to the Claude Code CLI that address CPU bottlenecks identified through static analysis of the minified JavaScript runtime and live process profiling.

**v2.1.45** (8 patches) — targets the dominant CPU consumers: forced GC every second, a permanently-alive 16ms animation timer, uncapped heap in remote mode, plus carried-forward caching patches.

**v2.1.29** (15 patches, legacy) — micro-optimizations for string concatenation, hash caching, array lookups, and more.

## Quick Start (v2.1.45)

```bash
# Clone the repository
git clone https://github.com/denysvitali/claude-code-patches.git
cd claude-code-patches

# Generate runtime patch
./patches-2.1.45.sh runtime

# Run Claude with optimizations
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch-2.1.45.js' claude
```

The v2.1.45 patches target the dominant CPU consumers identified in [FINDINGS_2.1.45.md](FINDINGS_2.1.45.md): forced GC every second, a permanently-alive 16ms animation timer, and uncapped heap in remote mode — none of which were addressed by the v2.1.29 patches.

## Quick Start (v2.1.29 — legacy)

```bash
./patches.sh runtime
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch.js' claude
```

### Permanent Alias

```bash
# Add to ~/.bashrc or ~/.zshrc
echo "alias claude-opt='NODE_OPTIONS=\"-r ~/.claude-optimizations/runtime-patch-2.1.45.js\" claude'" >> ~/.zshrc
source ~/.zshrc
```

## v2.1.45 Patches (8 patches)

These target the top CPU consumers from static + live analysis of v2.1.45:

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `setInterval(Bun.gc, 1000)` forces GC every second | **CRITICAL** | Replace with 120s non-blocking GC |
| 2 | 16ms `setInterval` animation timer alive at idle | **MEDIUM** | Throttle to 100ms floor |
| 3 | `--max-old-space-size=8192` in remote mode | **MEDIUM** | Cap at 2048 MB (configurable) |
| 4 | OTel + protobuf.js always loaded (~600 KB) | **LOW** | Set `DISABLE_TELEMETRY=1` early |
| 5 | 979 `process.env` accesses | **MEDIUM** | Startup snapshot cache |
| 6 | 34 `crypto.createHash` call sites | **MEDIUM** | LRU digest cache (500 entries) |
| 7 | 199 `JSON.stringify` + 119 `JSON.parse` calls | **LOW** | WeakMap + LRU cache |
| 8 | RegExp recompilation | **LOW** | Compiled pattern cache (200 entries) |

**Environment variables:**

| Variable | Default | Effect |
|----------|---------|--------|
| `CLAUDE_PATCH_NO_TIMER_THROTTLE` | unset | Set to `1` to disable the 16ms→100ms timer throttle |
| `CLAUDE_PATCH_MAX_HEAP_MB` | `2048` | Override the remote-mode heap cap |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | unset | Set to `1` to keep OTel telemetry enabled |

## v2.1.29 Patches (15 patches — legacy)

| Issue | Impact | Fix |
|-------|--------|-----|
| String `+=` in loops | O(n²) complexity, GC thrashing | String builder pool |
| SHA-256 without cache | Recomputes hashes repeatedly | LRU hash cache (500 entries) |
| Linear array search | O(n) lookups in hot paths | Fast Map-based lookup |
| Terminal rendering | 20k+ iterations per frame | Dirty-cell tracking |
| Char-by-char lexer | High per-iteration overhead | Batch processing |
| `Object.values()` calls | Repeated enumeration overhead | WeakMap memoization cache |
| `process.env` access | 34+ repeated lookups | Startup snapshot cache |
| `.push(...spread)` | Stack overflow risk, slow | Optimized bulk push |
| `indexOf` in loops | O(n) linear search | Map-based O(1) lookup |
| Deep property chains | Repeated property access | Cached property helper |
| Object allocations | 50+ GC pressure points | WeakMap object pool |
| `JSON.stringify/parse` | Repeated serialization | LRU cache (200 entries) |
| Inline regex patterns | Recompilation on every exec | Compiled regex cache (100 entries) |
| Buffer allocations | GC pressure in I/O | Tiered buffer pool |
| Individual async calls | Event loop overhead | Async operation batching |

See [PATCHES.md](PATCHES.md) for detailed descriptions of each v2.1.29 patch.

## Files

### v2.1.45
- **`patches-2.1.45.sh`** — Driver script (generates `~/.claude-optimizations/runtime-patch-2.1.45.js`)
- **`claude-code-cpu-patches-2.1.45.js`** — Full runtime patch module (8 patches)
- **`FINDINGS_2.1.45.md`** — Static + live analysis of v2.1.45 CPU/memory behavior

### v2.1.29 (legacy)
- **`patches.sh`** — Driver script for v2.1.29 patches
- **`claude-code-cpu-patches.js`** — Full runtime patch module (15 patches)
- **`PATCHES.md`** — Detailed technical documentation of v2.1.29 patches

## Verification

```bash
# v2.1.45
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch-2.1.45.js' claude
# Should see: "[v2.1.45 patch] Loaded — 8 patches active"
# Should see: "[v2.1.45 patch] Intercepted setInterval(Bun.gc, 1000) → replacing with 120s non-blocking GC"

# v2.1.29 (legacy)
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch.js' claude
# Should see: "[✓] Claude Code CPU optimizations active (enhanced mode)"
```

## Troubleshooting

### "Cannot find module"
Ensure the patch file path is absolute:
```bash
NODE_OPTIONS="-r $(realpath ~/.claude-optimizations/runtime-patch-2.1.45.js)" claude
```

### Patches not taking effect
Check if patch loaded:
```bash
NODE_OPTIONS="-r ~/.claude-optimizations/runtime-patch-2.1.45.js" claude --version
# Should see "[v2.1.45 patch] Loaded — 8 patches active"
```

## Disclaimer

**Results may vary.** These patches address real algorithmic inefficiencies found in the minified code, but:

- Perceived improvements may be influenced by placebo effect
- No scientific A/B testing has been conducted
- Your hardware, workflow, and usage patterns will affect results
- This is not officially endorsed by Anthropic

Use at your own risk.

## License

MIT
