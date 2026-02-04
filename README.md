# claude-code-patches

CPU optimization patches for Claude Code CLI v2.1.29 that reduce CPU usage through runtime patching.

> [!NOTE]  
> This has been entirely vibe coded w/ Kimi K2.5 - but tested on my machine.
> It's impressively good, but it might be placebo.  
> Use at your own risk and tell me what you think!

## Overview

This project applies 15 targeted performance patches to the Claude Code CLI that address common CPU bottlenecks in the minified JavaScript runtime. These patches fix issues like:

- O(n²) string concatenation in hot loops
- Repeated SHA-256 hash computations without caching
- Linear array searches in performance-critical paths
- Excessive terminal rendering iterations
- Repeated object allocations causing GC pressure

## Quick Start

```bash
# Clone the repository
git clone https://github.com/denysvitali/claude-code-patches.git
cd claude-code-patches

# Apply runtime patches (recommended)
./patches.sh runtime

# Run Claude with optimizations
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch.js' claude
```

## User Experience Note

I've been running Claude Code with these patches using:

```bash
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch.js' claude
```

Subjectively, I've noticed reduced CPU usage during normal operation, particularly during longer coding sessions. However, I must acknowledge that:

1. **This may be a placebo effect** - without rigorous A/B testing, it's hard to be certain
2. **Results may vary** - your workflow, hardware, and Claude usage patterns will differ
3. **No official benchmarks** - these are based on code analysis, not scientific measurement

The patches are sound from a computer science perspective (addressing real algorithmic issues), but the practical impact depends on many factors.

## What Gets Optimized

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

## The 15 Patches

### Patch 1: String Builder Pool
Eliminates O(n²) string concatenation by using array-based string builders with object pooling.

### Patch 2: Crypto Hash Cache
LRU cache (500 entries) for SHA-256 computations to avoid redundant hashing.

### Patch 3: Fast Array Lookup
Replaces linear search with Map-based O(1) lookups.

### Patch 4: Terminal Renderer
Dirty-cell tracking to avoid re-rendering unchanged portions of the terminal.

### Patch 5: Batch Character Processing
Regex-based tokenization instead of char-by-char loops.

### Patch 6: Object.values() Cache
WeakMap memoization with key-count invalidation.

### Patch 7: process.env Cache
Startup snapshot of frequently accessed environment variables.

### Patch 8: Optimized Array Push
Safe spread operation using apply for small arrays, loops for large.

### Patch 9: Map-based IndexOf
Fast index lookups using Map-based indexing.

### Patch 10: Property Access Cache
Cached deep property access with TTL.

### Patch 11: Object Pool
WeakMap-based pooling for arrays and objects.

### Patch 12: JSON Cache
Stringify/parse memoization with WeakMap for objects.

### Patch 13: Regex Cache
Compiled pattern caching (100 entries, LRU eviction).

### Patch 14: Buffer Pool
Tiered I/O buffer pooling (256B, 4KB, 64KB).

### Patch 15: Async Batching
Microtask batch execution for async operations.

## Usage Examples

### Runtime Patching (Recommended)
```bash
./patches.sh runtime
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch.js' claude
```

### Ultra-Compact One-Liner
```bash
NODE_OPTIONS='-r <(echo '"'"'const p=[],m=new Map(),s=()=>p.pop()||[],r=a=>{a.length=0;p.push(a)};globalThis.__c={p,m,s,r};console.log("[CPU] Active")'"'"')' claude
```

### Permanent Alias
```bash
# Add to ~/.bashrc or ~/.zshrc
echo "alias claude-opt='NODE_OPTIONS=\"-r ~/.claude-optimizations/runtime-patch.js\" claude'" >> ~/.bashrc
source ~/.bashrc
```

### Full Module Patching
```bash
NODE_OPTIONS='-r /path/to/claude-code-cpu-patches.js' claude
```

## Files

- **`patches.sh`** - Main patch script with multiple modes (runtime, binary, oneliners)
- **`claude-code-cpu-patches.js`** - Full runtime patch module (all 15 patches)
- **`claude_code.js`** - Extracted minified code for analysis
- **`PATCHES.md`** - Detailed technical documentation of each patch
- **`README.md`** - This file

## Verification

Check that patches are loaded:

```bash
NODE_OPTIONS='-r ~/.claude-optimizations/runtime-patch.js' claude
# Should see: "[✓] Claude Code CPU optimizations active (enhanced mode)"
# Should show all 15 patches loaded
```

## Troubleshooting

### "Cannot find module"
Ensure the patch file path is absolute:
```bash
NODE_OPTIONS="-r $(realpath ~/.claude-optimizations/runtime-patch.js)" claude
```

### Patches not taking effect
Check if patch loaded:
```bash
NODE_OPTIONS="-r ~/.claude-optimizations/runtime-patch.js" claude --version
# Should see "[✓] Claude Code CPU optimizations active"
```

### High memory usage
The hash cache defaults to 500 entries. Reduce if needed by editing `~/.claude-optimizations/runtime-patch.js`:
```javascript
const __maxCache = 100;  // Reduce from default 500
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
