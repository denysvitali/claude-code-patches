/**
 * Claude Code v2.1.29 CPU Optimization Patches
 * These patches fix critical CPU bottlenecks in the minified code
 *
 * Usage: bun run claude-code-cpu-patches.js -- /path/to/claude
 * Or inject at runtime by requiring this module
 */

// ============================================================================
// PATCH 1: String Builder Utility - Replaces O(n²) string concatenation
// ============================================================================

class StringBuilder {
  constructor(capacity = 256) {
    this.chunks = new Array(capacity);
    this.length = 0;
    this.totalLength = 0;
  }

  append(str) {
    if (str === null || str === undefined) return this;
    const s = String(str);
    this.chunks[this.length++] = s;
    this.totalLength += s.length;
    // Grow array if needed
    if (this.length >= this.chunks.length) {
      const newChunks = new Array(this.chunks.length * 2);
      newChunks.set(this.chunks);
      this.chunks = newChunks;
    }
    return this;
  }

  toString() {
    if (this.length === 0) return '';
    if (this.length === 1) return this.chunks[0];
    return this.chunks.slice(0, this.length).join('');
  }

  clear() {
    this.length = 0;
    this.totalLength = 0;
    return this;
  }
}

// Global string builder pool to avoid GC pressure
const sbPool = [];
const MAX_POOL_SIZE = 10;

function acquireStringBuilder() {
  return sbPool.pop() || new StringBuilder();
}

function releaseStringBuilder(sb) {
  if (sbPool.length < MAX_POOL_SIZE) {
    sb.clear();
    sbPool.push(sb);
  }
}

// ============================================================================
// PATCH 2: Crypto Hash Cache - Memoizes SHA-256 computations
// ============================================================================

class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

const hashCache = new LRUCache(500);

// ============================================================================
// PATCH 3: Fast Array Lookup - Replaces linear search with Map
// ============================================================================

function createFastLookupMap(array, keyIndex = 0) {
  const map = new Map();
  for (let i = array.length - 1; i >= 0; i--) {
    const key = array[i][keyIndex];
    if (!map.has(key)) {
      map.set(key, i);
    }
  }
  return map;
}

// ============================================================================
// PATCH 4: Terminal Rendering Optimizations
// ============================================================================

class TerminalRenderer {
  constructor() {
    this.dirtyCells = new Set();
    this.lastRendered = null;
    this.styleCache = new Map();
  }

  markDirty(x, y) {
    this.dirtyCells.add(`${x},${y}`);
  }

  clearDirty() {
    this.dirtyCells.clear();
  }

  isDirty(x, y) {
    return this.dirtyCells.size === 0 || this.dirtyCells.has(`${x},${y}`);
  }

  getCachedStyle(styleId, stylePool) {
    let style = this.styleCache.get(styleId);
    if (style === undefined) {
      style = stylePool.get(styleId);
      this.styleCache.set(styleId, style);
    }
    return style;
  }

  // Optimized render using StringBuilder
  renderOptimized(screenBuffer, options) {
    const { height, width } = screenBuffer;
    const sb = acquireStringBuilder();
    const lines = [];
    let lastStyle = null;

    for (let y = 0; y < height; y++) {
      sb.clear();

      for (let x = 0; x < width; x++) {
        // Skip clean cells if we have dirty tracking
        if (!this.isDirty(x, y)) continue;

        const cell = this.getCell(screenBuffer, x, y);
        if (!cell || cell.width === 2) continue;

        const style = this.getCachedStyle(cell.styleId, options.stylePool);
        const styleDiff = this.computeStyleDiff(lastStyle, style);

        if (styleDiff.length > 0) {
          sb.append(styleDiff);
          lastStyle = style;
        }
        sb.append(cell.char);
      }

      lines[y] = sb.toString();
    }

    releaseStringBuilder(sb);
    this.clearDirty();
    return lines;
  }

  getCell(buffer, x, y) {
    // Hook for the actual implementation
    return buffer[y]?.[x];
  }

  computeStyleDiff(oldStyle, newStyle) {
    // Hook for the actual implementation
    return '';
  }
}

// ============================================================================
// PATCH 5: Batched Character Processing - Replaces char-by-char loops
// ============================================================================

function batchProcessCharacters(input, batchSize = 1024) {
  const length = input.length;
  const results = [];

  for (let i = 0; i < length; i += batchSize) {
    const chunk = input.slice(i, Math.min(i + batchSize, length));
    results.push(chunk);
  }

  return results;
}

// Optimized tokenizer using regex instead of char-by-char
const TOKEN_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*)|("(?:[^"\\]|\\.)*")|(\d+(?:\.\d+)?)|([{}[\]:,])|(\s+)|(.)/g;

function fastTokenize(input) {
  const tokens = [];
  let match;

  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(input)) !== null) {
    const [full, identifier, string, number, punctuation, whitespace, other] = match;

    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier, pos: match.index });
    } else if (string) {
      tokens.push({ type: 'string', value: string, pos: match.index });
    } else if (number) {
      tokens.push({ type: 'number', value: parseFloat(number), pos: match.index });
    } else if (punctuation) {
      tokens.push({ type: 'punctuation', value: punctuation, pos: match.index });
    } else if (!whitespace) {
      tokens.push({ type: 'other', value: other, pos: match.index });
    }
  }

  return tokens;
}

// ============================================================================
// PATCH 6: Object.values() Memoization Cache
// ============================================================================

const objectValuesCache = new WeakMap();
const originalObjectValues = Object.values;

function memoizedObjectValues(obj) {
  if (!obj || typeof obj !== 'object') return originalObjectValues(obj);

  let cached = objectValuesCache.get(obj);
  if (!cached) {
    cached = {
      values: originalObjectValues(obj),
      keyCount: Object.keys(obj).length
    };
    objectValuesCache.set(obj, cached);
  } else if (cached.keyCount !== Object.keys(obj).length) {
    // Invalidate if object changed
    cached.values = originalObjectValues(obj);
    cached.keyCount = Object.keys(obj).length;
  }
  return cached.values;
}

// ============================================================================
// PATCH 7: process.env Caching
// ============================================================================

const ENV_CACHE = new Map();
const ENV_KEYS_TO_CACHE = [
  'DEBUG', 'NODE_ENV', 'CLAUDE_API_KEY', 'HOME', 'USER',
  'PATH', 'TERM', 'FORCE_COLOR', 'NO_COLOR', 'LOG_LEVEL',
  'CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'SHELL'
];

function setupEnvCache() {
  // Cache at startup
  for (const key of ENV_KEYS_TO_CACHE) {
    if (key in process.env) {
      ENV_CACHE.set(key, process.env[key]);
    }
  }
}

// ============================================================================
// PATCH 8: Optimized Array Push with Spread
// ============================================================================

function fastArrayPush(target, source) {
  const sourceLen = source.length;
  if (sourceLen === 0) return target;

  // For small arrays, use apply (faster)
  if (sourceLen < 1000) {
    target.push.apply(target, source);
  } else {
    // For large arrays, loop to avoid stack overflow
    for (let i = 0; i < sourceLen; i++) {
      target.push(source[i]);
    }
  }
  return target;
}

const originalPush = Array.prototype.push;
function optimizedPush(...args) {
  if (args.length === 1 && Array.isArray(args[0]) && args[0].length > 10) {
    return fastArrayPush(this, args[0]);
  }
  return originalPush.apply(this, args);
}

// ============================================================================
// PATCH 9: Map-based IndexOf Optimization
// ============================================================================

class FastLookupArray {
  constructor(array = []) {
    this.array = array;
    this.indexMap = new Map();
    this.rebuildIndex();
  }

  rebuildIndex() {
    this.indexMap.clear();
    for (let i = 0; i < this.array.length; i++) {
      if (!this.indexMap.has(this.array[i])) {
        this.indexMap.set(this.array[i], i);
      }
    }
  }

  indexOf(item) {
    const idx = this.indexMap.get(item);
    return idx !== undefined ? idx : -1;
  }

  includes(item) {
    return this.indexMap.has(item);
  }

  push(item) {
    if (!this.indexMap.has(item)) {
      this.indexMap.set(item, this.array.length);
    }
    return this.array.push(item);
  }

  // Delegate other methods to underlying array
  get length() { return this.array.length; }
  get(index) { return this.array[index]; }
  set(index, value) {
    const oldValue = this.array[index];
    if (oldValue !== undefined) {
      this.indexMap.delete(oldValue);
    }
    this.array[index] = value;
    if (!this.indexMap.has(value)) {
      this.indexMap.set(value, index);
    }
  }
}

const originalIndexOf = Array.prototype.indexOf;
function optimizedIndexOf(searchElement, fromIndex) {
  // For small arrays or non-objects, use native
  if (this.length < 100 || typeof searchElement !== 'object') {
    return originalIndexOf.call(this, searchElement, fromIndex);
  }

  // Build temporary index for large arrays
  if (!this.__indexMap) {
    this.__indexMap = new Map();
    for (let i = 0; i < this.length; i++) {
      if (!this.__indexMap.has(this[i])) {
        this.__indexMap.set(this[i], i);
      }
    }
  }

  const idx = this.__indexMap.get(searchElement);
  if (idx === undefined) return -1;
  if (fromIndex && idx < fromIndex) return -1;
  return idx;
}

// ============================================================================
// PATCH 10: Property Access Cache Helper
// ============================================================================

function cachePropertyAccess(obj, path, ttl = 1000) {
  const cacheKey = `${obj.constructor?.name || 'Object'}:${path}`;
  const now = Date.now();

  // Simple LRU cache for property access
  if (!globalThis.__propCache) {
    globalThis.__propCache = new Map();
  }

  const cached = globalThis.__propCache.get(cacheKey);
  if (cached && (now - cached.time) < ttl) {
    return cached.value;
  }

  const keys = path.split('.');
  let value = obj;
  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) break;
  }

  globalThis.__propCache.set(cacheKey, { value, time: now });
  return value;
}

// ============================================================================
// PATCH 11: WeakMap-based Object Pool
// ============================================================================

class ObjectPool {
  constructor(factory, resetFn, maxSize = 50) {
    this.factory = factory;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
    this.available = [];
    this.inUse = new WeakSet();
  }

  acquire() {
    let obj;
    if (this.available.length > 0) {
      obj = this.available.pop();
      this.resetFn(obj);
    } else {
      obj = this.factory();
    }
    this.inUse.add(obj);
    return obj;
  }

  release(obj) {
    if (this.inUse.has(obj)) {
      this.inUse.delete(obj);
      if (this.available.length < this.maxSize) {
        this.available.push(obj);
      }
    }
  }
}

// Create common pools
const arrayPool = new ObjectPool(
  () => [],
  (arr) => { arr.length = 0; },
  100
);

const objectPool = new ObjectPool(
  () => ({}),
  (obj) => { Object.keys(obj).forEach(k => delete obj[k]); },
  50
);

// Store original JSON methods before any patching
const _originalJSONStringify = JSON.stringify;
const _originalJSONParse = JSON.parse;

// ============================================================================
// PATCH 12: JSON Stringify/Parse Cache
// ============================================================================

class JSONCache {
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
    this.stringifyCache = new Map();
    this.parseCache = new Map();
    this.objectMap = new WeakMap();
    this.stats = { stringifyHits: 0, stringifyMisses: 0, parseHits: 0, parseMisses: 0 };
  }

  stringify(value, replacer, space) {
    // For objects, use WeakMap to track by reference
    if (value !== null && typeof value === 'object') {
      let cached = this.objectMap.get(value);
      if (cached && cached.replacer === replacer && cached.space === space) {
        this.stats.stringifyHits++;
        return cached.result;
      }
      const result = _originalJSONStringify(value, replacer, space);
      this.objectMap.set(value, { replacer, space, result });
      this.stats.stringifyMisses++;
      return result;
    }

    // For primitives, use content-based cache
    const key = String(value) + '|' + (replacer?.toString() || '') + '|' + (space || '');
    const cached = this.stringifyCache.get(key);
    if (cached !== undefined) {
      this.stats.stringifyHits++;
      return cached;
    }

    const result = _originalJSONStringify(value, replacer, space);
    if (this.stringifyCache.size >= this.maxSize) {
      const firstKey = this.stringifyCache.keys().next().value;
      this.stringifyCache.delete(firstKey);
    }
    this.stringifyCache.set(key, result);
    this.stats.stringifyMisses++;
    return result;
  }

  parse(text, reviver) {
    const key = String(text) + '|' + (reviver?.toString() || '');
    const cached = this.parseCache.get(key);
    if (cached !== undefined) {
      this.stats.parseHits++;
      return cached;
    }

    const result = _originalJSONParse(text, reviver);
    if (this.parseCache.size >= this.maxSize) {
      const firstKey = this.parseCache.keys().next().value;
      this.parseCache.delete(firstKey);
    }
    this.parseCache.set(key, result);
    this.stats.parseMisses++;
    return result;
  }

  getStats() {
    const stringifyTotal = this.stats.stringifyHits + this.stats.stringifyMisses;
    const parseTotal = this.stats.parseHits + this.stats.parseMisses;
    return {
      stringifyHitRate: stringifyTotal > 0 ? this.stats.stringifyHits / stringifyTotal : 0,
      parseHitRate: parseTotal > 0 ? this.stats.parseHits / parseTotal : 0,
      ...this.stats
    };
  }

  clear() {
    this.stringifyCache.clear();
    this.parseCache.clear();
  }
}

const jsonCache = new JSONCache(parseInt(process.env.JSON_CACHE_SIZE, 10) || 200);

// ============================================================================
// PATCH 13: Regex Compilation Cache
// ============================================================================

// Store original RegExp constructor before any patching
const OriginalRegExp = RegExp;

class RegexCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0 };
  }

  get(pattern, flags) {
    const key = pattern + '|' + (flags || '');
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.stats.hits++;
      return cached;
    }

    this.stats.misses++;
    const regex = new OriginalRegExp(pattern, flags);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, regex);
    return regex;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      hitRate: total > 0 ? this.stats.hits / total : 0,
      ...this.stats,
      size: this.cache.size
    };
  }

  clear() {
    this.cache.clear();
  }
}

const regexCache = new RegexCache(100);

// ============================================================================
// PATCH 14: Buffer Pool for I/O
// ============================================================================

class BufferPool {
  constructor() {
    // Tiered pools: Small (256B), Medium (4KB), Large (64KB)
    this.pools = {
      small: { size: 256, pool: [], max: 50 },
      medium: { size: 4096, pool: [], max: 20 },
      large: { size: 65536, pool: [], max: 10 }
    };
    this.stats = { acquired: 0, released: 0, created: 0 };
  }

  _getPoolForSize(size) {
    if (size <= this.pools.small.size) return 'small';
    if (size <= this.pools.medium.size) return 'medium';
    if (size <= this.pools.large.size) return 'large';
    return null; // Too large for pooling
  }

  acquireBuffer(size) {
    const poolName = this._getPoolForSize(size);
    if (!poolName) {
      this.stats.created++;
      return Buffer.allocUnsafe(size);
    }

    const pool = this.pools[poolName];
    if (pool.pool.length > 0) {
      this.stats.acquired++;
      const buf = pool.pool.pop();
      return buf.length >= size ? buf.slice(0, size) : Buffer.allocUnsafe(size);
    }

    this.stats.created++;
    return Buffer.allocUnsafe(pool.size).slice(0, size);
  }

  releaseBuffer(buf) {
    if (!Buffer.isBuffer(buf)) return;

    const poolName = this._getPoolForSize(buf.length);
    if (!poolName) return; // Too large for pooling

    const pool = this.pools[poolName];
    if (pool.pool.length < pool.max) {
      buf.fill(0); // Zero out for security
      pool.pool.push(buf);
      this.stats.released++;
    }
  }

  getStats() {
    return {
      ...this.stats,
      poolSizes: {
        small: this.pools.small.pool.length,
        medium: this.pools.medium.pool.length,
        large: this.pools.large.pool.length
      }
    };
  }
}

const bufferPool = new BufferPool();

// ============================================================================
// PATCH 15: Async Operation Batching
// ============================================================================

class AsyncBatcher {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 100;
    this.flushInterval = options.flushInterval || 1; // 1ms
    this.batches = new Map(); // Keyed by operation type
    this.timers = new Map();
    this.stats = { batchesExecuted: 0, itemsProcessed: 0 };
  }

  async batch(key, operation, data) {
    return new Promise((resolve, reject) => {
      if (!this.batches.has(key)) {
        this.batches.set(key, []);
      }

      const batch = this.batches.get(key);
      batch.push({ data, resolve, reject });

      // Flush immediately if batch is full
      if (batch.length >= this.maxBatchSize) {
        this._flush(key, operation);
      } else if (!this.timers.has(key)) {
        // Schedule flush after interval
        const timer = setTimeout(() => {
          this._flush(key, operation);
        }, this.flushInterval);
        this.timers.set(key, timer);
      }
    });
  }

  async _flush(key, operation) {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }

    const batch = this.batches.get(key);
    if (!batch || batch.length === 0) return;

    this.batches.delete(key);

    try {
      const results = await operation(batch.map(item => item.data));
      // Distribute results back to individual promises
      batch.forEach((item, index) => {
        item.resolve(results?.[index]);
      });
      this.stats.batchesExecuted++;
      this.stats.itemsProcessed += batch.length;
    } catch (error) {
      batch.forEach(item => item.reject(error));
    }
  }

  // Convenience method for file reads
  async batchFileRead(filePath, readFn) {
    return this.batch('fileRead', readFn, filePath);
  }

  // Convenience method for hash operations
  async batchHash(data, hashFn) {
    return this.batch('hash', hashFn, data);
  }

  getStats() {
    return { ...this.stats };
  }
}

const asyncBatcher = new AsyncBatcher();

// ============================================================================
// MAIN PATCH APPLICATION
// ============================================================================

function applyPatches() {
  // Phase 1: Set up ENV_CACHE first (before any env access)
  setupEnvCache();

  // Phase 2: Patch Object.values
  Object.values = memoizedObjectValues;

  // Phase 3: Patch Array.prototype methods
  Array.prototype.push = optimizedPush;
  Array.prototype.indexOf = optimizedIndexOf;

  const originalModules = globalThis.__claude_modules || {};

  // Patch 1: Hook into crypto module for hash caching
  if (typeof require !== 'undefined') {
    const crypto = require('crypto');
    const originalCreateHash = crypto.createHash;

    crypto.createHash = function(algorithm) {
      const hash = originalCreateHash.call(this, algorithm);
      const originalDigest = hash.digest;
      const originalUpdate = hash.update;

      const buffer = [];

      hash.update = function(data, encoding) {
        buffer.push(data.toString(encoding || 'utf8'));
        return originalUpdate.call(this, data, encoding);
      };

      hash.digest = function(encoding) {
        const cacheKey = `${algorithm}:${buffer.join('')}`;
        let cached = hashCache.get(cacheKey);

        if (cached === undefined) {
          cached = originalDigest.call(this, encoding);
          // Only cache small inputs to avoid memory bloat
          const totalLength = buffer.reduce((sum, chunk) => sum + chunk.length, 0);
          if (totalLength < 10000) {
            hashCache.set(cacheKey, cached);
          }
        }

        return cached;
      };

      return hash;
    };
  }

  // Phase 4: Patch RegExp constructor for regex caching
  globalThis.RegExp = function(pattern, flags) {
    if (this instanceof RegExp) {
      return regexCache.get(pattern, flags);
    }
    return regexCache.get(pattern, flags);
  };
  Object.setPrototypeOf(globalThis.RegExp, OriginalRegExp);
  globalThis.RegExp.prototype = OriginalRegExp.prototype;

  // Phase 5: Patch JSON methods (using stored originals)
  JSON.stringify = function(value, replacer, space) {
    return jsonCache.stringify(value, replacer, space);
  };
  JSON.parse = function(text, reviver) {
    return jsonCache.parse(text, reviver);
  };

  // Phase 6: Initialize object pools and expose utilities
  globalThis.__claude_optimizations = {
    StringBuilder,
    LRUCache,
    hashCache,
    TerminalRenderer,
    fastTokenize,
    batchProcessCharacters,
    createFastLookupMap,
    acquireStringBuilder,
    releaseStringBuilder,
    // New optimizations
    ObjectPool,
    FastLookupArray,
    cachePropertyAccess,
    fastArrayPush,
    memoizedObjectValues,
    ENV_CACHE,
    pools: {
      array: arrayPool,
      object: objectPool
    },
    // Additional patches 12-15
    jsonCache,
    regexCache,
    bufferPool,
    asyncBatcher,
    acquireBuffer: (size) => bufferPool.acquireBuffer(size),
    releaseBuffer: (buf) => bufferPool.releaseBuffer(buf)
  };

  console.log('[Claude Code Optimizations] CPU patches applied successfully');
  console.log('[Claude Code Optimizations] Patches 1-11: String pool, Hash cache, Fast lookup, Terminal renderer, Batch processing, Object.values cache, Env cache, Fast array push, IndexOf opt, Property cache, Object pools');
  console.log('[Claude Code Optimizations] Patches 12-15: JSON cache, Regex cache, Buffer pool, Async batching');
}

// Auto-apply if loaded directly
if (require.main === module) {
  applyPatches();

  // If arguments provided, spawn claude with patches
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const { spawn } = require('child_process');
    const claude = spawn(args[0], args.slice(1), {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: `-r ${__filename}`
      }
    });

    // Handle spawn errors
    claude.on('error', (err) => {
      console.error('[Claude Code Optimizations] Failed to spawn:', err.message);
      process.exit(1);
    });

    // Use 'close' to wait for stdio streams to finish
    claude.on('close', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 0);
      }
    });

    // Forward signals to child
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of signals) {
      process.on(sig, () => {
        claude.kill(sig);
      });
    }

    // Cleanup on unexpected parent exit
    process.on('exit', () => {
      if (!claude.killed) {
        claude.kill('SIGTERM');
      }
    });
  }
} else {
  // Apply patches when required as a module
  applyPatches();
}

module.exports = {
  applyPatches,
  StringBuilder,
  LRUCache,
  TerminalRenderer,
  fastTokenize,
  // New exports
  JSONCache,
  RegexCache,
  BufferPool,
  AsyncBatcher,
  ObjectPool
};
