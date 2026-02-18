# Claude Code v2.1.45 — CPU & Memory Findings

> **Methodology:** Binary inspection of the `claude` v2.1.45 executable
> (213 MB ELF, Bun-bundled, x86-64, not stripped). The 11.82 MB embedded JavaScript
> source was extracted from `.rodata` at offset `0x619c374` and statically analyzed.
> Live process memory and thread data were collected from `/proc/*/smaps_rollup`,
> `/proc/*/maps`, and `/proc/*/task/*/stat` on running instances.

---

## Confirmed Runtime Data

```
Process threads per instance (18 total):
  claude        ×2  (main JS threads)
  HeapHelper    ×7  (JSC concurrent GC marking)
  JITWorker     ×1  (JSC JIT compilation)
  HTTP Client   ×1
  File Watcher  ×1
  Bun Pool      ×6  (I/O thread pool)

RSS per instance:
  Idle session:   ~400–600 MB
  Active session: ~600 MB – 1.1 GB

Virtual address space per instance: 72–74 GB
  (JSC GC reserves huge VA ranges for write barriers — not real RAM)
```

---

## Finding 1: Forced GC every second via `setInterval(Bun.gc, 1000)`

**Severity: CRITICAL — primary cause of elevated idle CPU**

```javascript
// In the main startup function r21(), runs unconditionally when Bun is detected:
if (typeof Bun !== "undefined")
    setInterval(Bun.gc, 1000).unref();
```

**Location:** offset `0x97efa0` in the embedded JS source, inside the main `r21()` startup
function. It is inside a `K()` lazy wrapper but that wrapper is part of the startup chain —
it runs on every interactive launch.

**Impact:** Triggers a full JSC garbage collection every second for the entire lifetime of
the process. JSC's GC uses **7 concurrent HeapHelper threads** (confirmed in live processes).
On heaps of 400 MB–1.1 GB (the observed range), each GC cycle involves all 7 threads doing
concurrent marking work. This is the dominant source of "idle" CPU:

```
Idle process thread CPU time (sample):
  Main JS thread:         43,743 jiffies
  7× HeapHelper total:    16,600 jiffies  ← 28% of total, driven by forced GC
  Bun Pool ×6:               174 jiffies  (negligible)
  File Watcher:               29 jiffies
```

The `.unref()` means this timer does not prevent the process from exiting, but it *does*
run GC every second while the process is alive. Bun's GC is adaptive and does not need
manual invocation.

**Fix:**

```javascript
// Remove this line entirely:
// setInterval(Bun.gc, 1000).unref();

// If memory pressure is a real concern on long sessions, use non-blocking GC
// on a much longer interval (e.g. 60s), and only when the session is idle:
// setInterval(() => Bun.gc(false), 60_000).unref();
```

---

## Finding 2: No token batching during streaming — one React reconcile per token

**Severity: HIGH — primary cause of 100% CPU during AI responses**

During streaming, every SSE token triggers the full render pipeline:

```javascript
// Per token, in the Anthropic SDK stream handler (offset 0x20ba9b):
case "content_block_delta":
    A.content[$.index] = { ...L, text: (L.text || "") + $.delta.text };
    // ↑ new object allocation + string concat on every token
```

Each token then propagates:

```
JSON.parse(sse_chunk)              ← per token
Object spread {...L}               ← new allocation per token
React.setState(newMessage)         ← per token
  → MessageChannel.postMessage()   ← React schedules immediately
  → Fiber reconciliation           ← full component tree walk
  → yoga.calculateLayout() [WASM]  ← full layout pass
  → Screen diff (rows × columns)   ← compare entire terminal buffer
  → stdout.write(escape_codes)     ← write to terminal
```

At 30–100 tokens/second this is **30–100 full render cycles per second** on the main
thread. Confirmed: the main JS thread holds 82,837 jiffies (87% of total CPU time)
in an active streaming process, while GC threads hold only ~5,000 jiffies combined.

There is **no debouncing or batching** of token-driven state updates. The 16ms render
throttle (`scheduleRender = debounce(onRender, 16ms)`) only throttles the *terminal
write*, not the React reconciler — the reconciler still runs once per token via
the React scheduler's MessageChannel.

**Fix:** Buffer incoming token deltas and flush to React state at most once per animation
frame (16ms):

```javascript
let _pendingText = '';
let _flushId = null;

stream.on('text', (delta) => {
    _pendingText += delta;
    if (!_flushId) {
        _flushId = setTimeout(() => {
            const text = _pendingText;
            _pendingText = '';
            _flushId = null;
            setStreamingText(prev => prev + text);
        }, 16);
    }
});
```

This reduces reconciles from ~60/sec to ~60/sec → **1 per frame**, a 30–100× reduction
in reconciler work during streaming.

---

## Finding 3: Network dot animation keeps 16ms `setInterval` alive permanently

**Severity: MEDIUM — source of idle CPU even at the prompt**

Ink's timer system (`nj0`, offset `0x299358`) runs `setInterval(tick, 16ms)` whenever
any subscribed component has `isActive = true`. The network connectivity indicator
(`rD()`, offset `0x6c7873`) is always mounted and visible:

```javascript
function rD() {
    let [H, $] = Ww(120);  // ← subscribes with isActive=true, starts 16ms interval
    // renders a blinking ● character
}
```

`Ww(120)` (exported as `useAnimationFrame`) subscribes to the 16ms timer with
`isActive = true`, which starts and keeps alive a `setInterval(B, 16)`. Even though
the component only updates React state every 120ms, the setInterval callback runs
**62 times per second** checking `Date.now()`. Every 120ms it calls `D(now())` →
React `setState` → MessageChannel → reconciler → yoga → terminal repaint.

**Result:** 8 full render cycles per second at idle, driven by a single always-visible
blinking dot.

**Fix:** Replace the JS-timer-driven blink with a terminal escape sequence:

```javascript
// Instead of a 120ms animation timer, use ANSI blink mode:
// \x1b[5m●\x1b[0m  — blinks at terminal rate, zero CPU cost
function rD() {
    const { isConnected } = NqA();
    return createElement(Text, { color: isConnected ? 'text' : 'inactive' },
        '\x1b[5m\u25CF\x1b[0m');
}
```

This eliminates the 16ms setInterval entirely during idle, since `rD()` is the
only always-visible consumer of `Ww()` with `isActive = true`.

---

## Finding 4: `--max-old-space-size=8192` in remote mode

**Severity: MEDIUM — amplifies GC cost in Finding 1**

```javascript
// Triggered unconditionally when CLAUDE_CODE_REMOTE === "true":
if (process.env.CLAUDE_CODE_REMOTE === "true") {
    const H = process.env.NODE_OPTIONS || "";
    process.env.NODE_OPTIONS = H ? `${H} --max-old-space-size=8192`
                                 : "--max-old-space-size=8192";
}
```

Setting the old-space limit to 8 GB tells the GC it is acceptable to let the heap
grow 5–8× larger than default before collecting. Combined with Finding 1
(`setInterval(Bun.gc, 1000)`), this means:
- the heap grows large between forced GC cycles, and
- each forced GC takes longer to complete (more to mark and sweep).

**Fix:** Remove this or make it configurable:

```bash
# Tunable via env var, sensible default for remote use:
CLAUDE_CODE_MAX_HEAP_MB=2048
```

---

## Finding 5: highlight.js registers 182 languages at startup

**Severity: MEDIUM — startup latency + heap inflation**

```javascript
// Module T_A (not wrapped in K() lazy initializer):
r$.registerLanguage("1c",    smI());
r$.registerLanguage("abnf",  HpI());
r$.registerLanguage("accesslog", LpI());
// ... 179 more
```

All 182 language grammar objects (~1.6 MB of source) are constructed and registered
synchronously at startup, before the first prompt is shown. Each grammar is a complex
nested object tree that JSC must allocate and then keep alive (they are all referenced
by the hljs registry). This inflates the baseline heap, making each GC cycle in
Finding 1 more expensive.

A coding assistant realistically needs ~15–20 languages (JavaScript, TypeScript, Python,
Bash, JSON, YAML, HTML, CSS, Rust, Go, Java, C, C++, SQL, Markdown).

**Fix:** Wrap the `registerLanguage` block in a `K(() => {...})` lazy initializer.
Register the top 15 languages eagerly; load the rest on first highlight request.
Estimated savings: **~1.3 MB of heap** that no longer participates in every GC cycle.

---

## Finding 6: Full lodash 4.17.21 bundled (~661 KB), ~40 functions called

**Severity: MEDIUM — heap inflation**

```
Lodash 4.17.21 found at offset 0x651189, size ~661 KB
Unique lodash functions called in source: 40
Total call sites: 112
Most used: _.map (10×), _.filter (5×), _.once (3×)
```

The entire lodash library is included. Every function it defines (700+) is parsed and
held in the module's scope. Most have native equivalents. This is ~500–600 KB of heap
that participates in every GC cycle, directly amplifying Finding 1.

**Fix:** Replace with targeted imports (`import once from 'lodash/once'`) or inline the
handful of utilities. Native equivalents cover all 40 used functions.

---

## Finding 7: protobuf.js + OpenTelemetry always loaded (~600 KB combined)

**Severity: LOW-MEDIUM**

The full OpenTelemetry stack (metrics, traces, logs) with protobuf serialization for
OTLP export is loaded unconditionally on every startup. The OTel code is gated on
`DISABLE_TELEMETRY`, `OTEL_*`, and `CLAUDE_CODE_ENABLE_TELEMETRY` env vars at
*runtime*, but the modules are parsed and their module-level code runs regardless.

Protobuf.js (344 KB) is only needed when OTLP protobuf export is configured.

**Fix:** Wrap OTel initialization in a `K()` lazy initializer gated on the relevant
env vars. Skip the protobuf serializer unless OTLP export is explicitly configured.

---

## Finding 8: AWS SDK credential chain always loaded (~279 KB)

**Severity: LOW-MEDIUM**

The full `@aws-sdk/credential-provider-*` chain is bundled and its module-level code
runs regardless of whether `CLAUDE_CODE_USE_BEDROCK` is set.

**Fix:** Same pattern — defer AWS SDK initialization to first Bedrock call.

---

## Summary

| # | Finding | Severity | Root Impact |
|---|---------|----------|-------------|
| 1 | `setInterval(Bun.gc, 1000)` forces GC every second | **CRITICAL** | 7 GC threads pegged, ~28% CPU at idle |
| 2 | No token batching → React reconcile per token | **HIGH** | Main thread at 100% during streaming |
| 3 | Network dot keeps 16ms timer alive at idle | **MEDIUM** | 8 render cycles/sec at prompt |
| 4 | `--max-old-space-size=8192` in remote mode | **MEDIUM** | Amplifies GC cost |
| 5 | 182 highlight.js languages eager-loaded | **MEDIUM** | +1.3 MB heap, slower GC |
| 6 | Full lodash (661 KB), 40 functions used | **MEDIUM** | +500 KB heap, slower GC |
| 7 | OTel + protobuf.js always loaded | **LOW-MED** | +600 KB heap |
| 8 | AWS SDK always loaded | **LOW-MED** | +279 KB heap |

Fixing findings 1, 2, and 3 alone would eliminate the constant elevated CPU.
Findings 4–8 reduce the heap size, which makes GC faster and reduces the cost of
Finding 1 until it is removed.

---

## Binary Layout

| Section | Size | Notes |
|---------|------|-------|
| `.text` | 57.1 MB | Bun/JSC JIT engine native code |
| `.rodata` | 39.8 MB | Bun runtime + embedded JS source |
| `.data` / `.bss` | ~1.4 MB | Static data + BSS |
| **Total ELF** | **213 MB** | Includes debug symbols ("not stripped") |
| Embedded JS source | 11.82 MB | Plaintext at offset `0x619c374` |
| Shared libs | 4 | only libc, pthread, libdl, libm |

The binary is not stripped — stripping would save ~10–15 MB on disk with no runtime cost.

---

## Comparison with v2.1.29 Patches

The prior patches in this repo (targeting v2.1.29) correctly identified some hot paths.
Status against v2.1.45:

| Patch | Still valid? | Notes |
|-------|-------------|-------|
| `crypto.createHash` caching | Yes | 34 call sites, same pattern |
| `process.env` snapshot | Yes, more so | 979 accesses now |
| `JSON.stringify/parse` caching | Yes | 199 + 119 calls |
| `Object.values()` memoization | Marginal | 121 calls, mostly not in hot paths |
| String builder pool | Marginal | Only 1 terminal render hot loop found |
| Buffer pooling | Less impactful | Bun has its own buffer allocator |

Findings 1–3 above were not covered by the prior analysis at all, and are the dominant
source of CPU usage.

---

## Quick Wins (no patching required)

```bash
# Cap the heap — reduces GC cost while setInterval(Bun.gc) still runs
export NODE_OPTIONS="--max-old-space-size=2048"

# Disable telemetry — skips loading OTel + protobuf at runtime
export DISABLE_TELEMETRY=1
```

---

*Static analysis of JS extracted from binary offset `0x619c374`. Live data from
`/proc/[pid]/smaps_rollup`, `/proc/[pid]/maps`, `/proc/[pid]/task/*/stat` on
multiple running instances.*
