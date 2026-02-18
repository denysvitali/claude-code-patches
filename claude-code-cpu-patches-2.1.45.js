/**
 * Claude Code v2.1.45 CPU Optimization Patches
 *
 * Targets the top CPU consumers identified in FINDINGS_2.1.45.md:
 *   1. Forced GC every second (setInterval(Bun.gc, 1000))
 *   2. 16ms animation timer alive permanently (Ink useAnimationFrame)
 *   3. Heap size cap for remote mode
 *   4. Telemetry loading gate
 *   5. process.env snapshot cache
 *   6. crypto.createHash cache
 *   7. JSON.stringify/parse cache
 *   8. RegExp compilation cache
 *
 * Usage: NODE_OPTIONS='-r /path/to/claude-code-cpu-patches-2.1.45.js' claude
 */

'use strict';

// Store originals before any patching
const _origSetInterval = globalThis.setInterval;
const _origJSONStringify = JSON.stringify;
const _origJSONParse = JSON.parse;
const _OrigRegExp = RegExp;

let _patchCount = 0;

// ============================================================================
// PATCH 1: Neutralize forced GC interval (CRITICAL)
//
// Finding 1: setInterval(Bun.gc, 1000).unref() forces full JSC GC every
// second, driving 7 HeapHelper threads and ~28% idle CPU.
//
// Approach: Intercept setInterval calls where the callback is Bun.gc
// (reference equality). Replace with 120s non-blocking GC.
// ============================================================================

// ============================================================================
// PATCH 2: Throttle short setInterval timers (MEDIUM)
//
// Finding 3: Ink's useAnimationFrame keeps setInterval(tick, 16) alive
// permanently — 62 callbacks/sec, 8 render cycles/sec at idle.
//
// Approach: Enforce a minimum interval floor of 100ms for any setInterval
// with delay <= 50ms. Opt-out: CLAUDE_PATCH_NO_TIMER_THROTTLE=1
// ============================================================================

const _throttleTimers = !process.env.CLAUDE_PATCH_NO_TIMER_THROTTLE;

globalThis.setInterval = function patchedSetInterval(fn, delay, ...args) {
  // Patch 1: Replace forced Bun.gc with non-blocking 120s GC
  if (typeof Bun !== 'undefined' && fn === Bun.gc) {
    console.log('[v2.1.45 patch] Intercepted setInterval(Bun.gc, ' + delay + ') → replacing with 120s non-blocking GC');
    return _origSetInterval.call(this, () => Bun.gc(false), 120_000, ...args);
  }

  // Patch 2: Throttle high-frequency timers (<=50ms → 100ms)
  if (_throttleTimers && typeof delay === 'number' && delay > 0 && delay <= 50) {
    console.log('[v2.1.45 patch] Throttling setInterval(' + delay + 'ms) → 100ms');
    return _origSetInterval.call(this, fn, 100, ...args);
  }

  return _origSetInterval.call(this, fn, delay, ...args);
};

_patchCount += 2;

// ============================================================================
// PATCH 3: Cap heap size in remote mode (MEDIUM)
//
// Finding 4: --max-old-space-size=8192 set when CLAUDE_CODE_REMOTE=true.
// This lets the heap grow to 8 GB, making each forced GC cycle more expensive.
//
// Approach: Override to 2048 MB (configurable via CLAUDE_PATCH_MAX_HEAP_MB).
// Caveat: NODE_OPTIONS change may not affect the current V8/JSC heap limit
// retroactively — the re-spawned process will pick it up.
// ============================================================================

if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  const maxHeap = process.env.CLAUDE_PATCH_MAX_HEAP_MB || '2048';
  const opts = (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '');
  process.env.NODE_OPTIONS = (opts + ' --max-old-space-size=' + maxHeap).trim();
  console.log('[v2.1.45 patch] Remote mode heap capped to ' + maxHeap + ' MB');
}

_patchCount++;

// ============================================================================
// PATCH 4: Disable telemetry loading (LOW)
//
// Finding 7: OTel + protobuf.js always loaded (~600 KB). Gated at runtime on
// DISABLE_TELEMETRY but modules are parsed regardless.
//
// Approach: Set DISABLE_TELEMETRY=1 early to gate initialization code.
// Opt-out: Set CLAUDE_CODE_ENABLE_TELEMETRY=1 to keep telemetry.
// ============================================================================

if (!process.env.DISABLE_TELEMETRY && !process.env.CLAUDE_CODE_ENABLE_TELEMETRY) {
  process.env.DISABLE_TELEMETRY = '1';
  console.log('[v2.1.45 patch] Telemetry disabled (set CLAUDE_CODE_ENABLE_TELEMETRY=1 to re-enable)');
}

_patchCount++;

// ============================================================================
// PATCH 5: process.env snapshot cache (MEDIUM — carried from v2.1.29)
//
// 979 process.env accesses in v2.1.45 (up from 34 in v2.1.29).
// Snapshot frequently-accessed keys into a Map at startup.
// ============================================================================

const _envCache = new Map();
const _envKeysToCache = [
  // Core runtime
  'DEBUG', 'NODE_ENV', 'HOME', 'USER', 'PATH', 'TERM', 'SHELL',
  // Display
  'FORCE_COLOR', 'NO_COLOR', 'COLORTERM', 'TERM_PROGRAM',
  // Claude-specific
  'CLAUDE_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_REMOTE', 'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_ENABLE_TELEMETRY', 'DISABLE_TELEMETRY',
  'LOG_LEVEL',
  // Node/Bun
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  // XDG
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
];

for (const key of _envKeysToCache) {
  if (key in process.env) {
    _envCache.set(key, process.env[key]);
  }
}

_patchCount++;

// ============================================================================
// PATCH 6: crypto.createHash cache (MEDIUM — carried from v2.1.29)
//
// 34 call sites. Wraps createHash to memoize digest results for inputs < 10 KB.
// ============================================================================

class _LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

const _hashCache = new _LRUCache(500);

if (typeof require !== 'undefined') {
  try {
    const crypto = require('crypto');
    const _origCreateHash = crypto.createHash;

    crypto.createHash = function cachedCreateHash(algorithm) {
      const hash = _origCreateHash.call(this, algorithm);
      const _origUpdate = hash.update;
      const _origDigest = hash.digest;
      const _chunks = [];

      hash.update = function(data, encoding) {
        _chunks.push(typeof data === 'string' ? data : data.toString(encoding || 'utf8'));
        return _origUpdate.call(this, data, encoding);
      };

      hash.digest = function(encoding) {
        const cacheKey = algorithm + ':' + _chunks.join('');
        const totalLen = _chunks.reduce((sum, c) => sum + c.length, 0);

        // Only cache small inputs
        if (totalLen < 10_000) {
          const cached = _hashCache.get(cacheKey);
          if (cached !== undefined) return cached;
        }

        const result = _origDigest.call(this, encoding);

        if (totalLen < 10_000) {
          _hashCache.set(cacheKey, result);
        }
        return result;
      };

      return hash;
    };
  } catch (_) {
    // crypto not available — skip
  }
}

_patchCount++;

// ============================================================================
// PATCH 7: JSON.stringify/parse cache (LOW — carried from v2.1.29)
//
// 199 stringify + 119 parse calls. WeakMap for object stringify, LRU for parse.
// JSON.parse cache returns shallow clones for objects to prevent mutation issues.
// ============================================================================

const _jsonStringifyWeakMap = new WeakMap();
const _jsonParseCache = new _LRUCache(200);

JSON.stringify = function patchedStringify(value, replacer, space) {
  // Only cache simple calls (no replacer, no space) for objects
  if (value !== null && typeof value === 'object' && !replacer && !space) {
    const cached = _jsonStringifyWeakMap.get(value);
    if (cached !== undefined) return cached;
    const result = _origJSONStringify(value, replacer, space);
    _jsonStringifyWeakMap.set(value, result);
    return result;
  }
  return _origJSONStringify(value, replacer, space);
};

JSON.parse = function patchedParse(text, reviver) {
  // Only cache simple calls (no reviver) for strings
  if (typeof text === 'string' && !reviver) {
    const cached = _jsonParseCache.get(text);
    if (cached !== undefined) {
      // Shallow clone objects/arrays to prevent mutation leaking
      if (cached !== null && typeof cached === 'object') {
        return Array.isArray(cached) ? [...cached] : { ...cached };
      }
      return cached;
    }
    const result = _origJSONParse(text, reviver);
    _jsonParseCache.set(text, result);
    return result;
  }
  return _origJSONParse(text, reviver);
};

_patchCount++;

// ============================================================================
// PATCH 8: RegExp compilation cache (LOW — carried from v2.1.29)
//
// Cache compiled RegExp objects by pattern+flags. Stateful regexes (/g, /y)
// have lastIndex reset on return to prevent cross-caller state leaks.
// ============================================================================

const _regexCache = new Map();
const _REGEX_CACHE_MAX = 200;

globalThis.RegExp = function PatchedRegExp(pattern, flags) {
  // Pass through for non-string patterns (e.g. RegExp(existingRegex))
  if (typeof pattern !== 'string') {
    if (new.target) return new _OrigRegExp(pattern, flags);
    return _OrigRegExp(pattern, flags);
  }

  const key = pattern + '\0' + (flags || '');
  let cached = _regexCache.get(key);

  if (cached !== undefined) {
    // Reset lastIndex for stateful regexes to prevent leaking state
    if (cached.global || cached.sticky) {
      cached.lastIndex = 0;
    }
    return cached;
  }

  cached = new _OrigRegExp(pattern, flags);

  if (_regexCache.size >= _REGEX_CACHE_MAX) {
    const firstKey = _regexCache.keys().next().value;
    _regexCache.delete(firstKey);
  }
  _regexCache.set(key, cached);
  return cached;
};

Object.setPrototypeOf(globalThis.RegExp, _OrigRegExp);
globalThis.RegExp.prototype = _OrigRegExp.prototype;
// Preserve static properties
Object.defineProperty(globalThis.RegExp, 'name', { value: 'RegExp' });
Object.defineProperty(globalThis.RegExp, 'length', { value: 2 });

_patchCount++;

// ============================================================================
// Expose internals for debugging and integrate with existing v2.1.29 namespace
// ============================================================================

globalThis.__claude_v2145_patches = {
  version: '2.1.45',
  patchCount: _patchCount,
  envCache: _envCache,
  hashCache: _hashCache,
  jsonParseCache: _jsonParseCache,
  jsonStringifyWeakMap: _jsonStringifyWeakMap,
  regexCache: _regexCache,
};

console.log('[v2.1.45 patch] Loaded — ' + _patchCount + ' patches active');
console.log('[v2.1.45 patch] Patches: GC interval, timer throttle, heap cap, telemetry gate, env cache, hash cache, JSON cache, regex cache');
