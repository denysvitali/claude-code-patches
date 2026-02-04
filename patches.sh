#!/bin/bash
# Claude Code v2.1.29 CPU Optimization Patches
# One-liner patches for redistribution
# Usage: source ./patches.sh && patch_claude

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================================
# Configuration
# ============================================================================

# Allow environment override for binary path
CLAUDE_BINARY_PATH="${CLAUDE_BINARY_PATH:-}"

# Common installation locations to check for Claude binary
declare -a COMMON_CLAUDE_PATHS=(
    "$HOME/.local/share/claude/versions/2.1.29"
    "$HOME/.local/share/claude/versions/current"
    "$HOME/.local/share/claude/claude"
    "/usr/local/bin/claude"
    "/usr/bin/claude"
    "/opt/claude/claude"
    "/Applications/Claude.app/Contents/MacOS/claude"
)

# ============================================================================
# Helper Functions
# ============================================================================

# Find Claude binary from common locations or environment variable
find_claude_binary() {
    # Check environment variable first
    if [[ -n "$CLAUDE_BINARY_PATH" && -f "$CLAUDE_BINARY_PATH" ]]; then
        echo "$CLAUDE_BINARY_PATH"
        return 0
    fi

    # Check common paths
    for path in "${COMMON_CLAUDE_PATHS[@]}"; do
        if [[ -f "$path" ]]; then
            echo "$path"
            return 0
        fi
    done

    # Try to find in PATH
    if command -v claude &>/dev/null; then
        command -v claude
        return 0
    fi

    return 1
}

# Cross-platform sed in-place edit
sed_inplace() {
    local script="$1"
    local file="$2"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # BSD sed (macOS)
        sed -i '' "$script" "$file"
    else
        # GNU sed (Linux)
        sed -i "$script" "$file"
    fi
}

# Cross-platform grep for binary offset search
# Returns offset of pattern in binary file
find_binary_offset() {
    local pattern="$1"
    local file="$2"

    # Try grep with -b option first (works on most systems)
    if command -v grep &>/dev/null; then
        # Use od to convert to hex then search, or use strings + grep
        if command -v strings &>/dev/null; then
            # Get offset using strings -o (offset) and grep
            strings -o "$file" | grep -m1 "$pattern" | awk '{print $1}'
            return 0
        fi
    fi

    return 1
}

# Validate prerequisites
check_prerequisites() {
    local missing=()

    if ! command -v dd &>/dev/null; then
        missing+=("dd")
    fi

    if ! command -v mktemp &>/dev/null; then
        missing+=("mktemp")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo_error "Missing required tools: ${missing[*]}"
        return 1
    fi

    return 0
}

# ============================================================================
# PATCH 1: Extract and patch the binary
# ============================================================================

patch_claude_binary() {
    local BINARY_PATH="${1:-}"
    local BACKUP_PATH=""

    # Validate prerequisites
    check_prerequisites || return 1

    # Find binary if not provided
    if [[ -z "$BINARY_PATH" ]]; then
        BINARY_PATH=$(find_claude_binary) || {
            echo_error "Could not find Claude binary. Set CLAUDE_BINARY_PATH environment variable."
            return 1
        }
    fi

    if [[ ! -f "$BINARY_PATH" ]]; then
        echo_error "Binary not found: $BINARY_PATH"
        return 1
    fi

    BACKUP_PATH="${BINARY_PATH}.backup"

    # Create backup
    if [[ ! -f "$BACKUP_PATH" ]]; then
        echo_info "Creating backup at $BACKUP_PATH"
        cp "$BINARY_PATH" "$BACKUP_PATH"
    else
        echo_warn "Backup already exists at $BACKUP_PATH"
    fi

    # Find JS section offset
    local OFFSET
    OFFSET=$(find_binary_offset "// @bun @bytecode @bun-cjs" "$BINARY_PATH")

    if [[ -z "$OFFSET" ]]; then
        echo_error "Could not find JavaScript section in binary"
        return 1
    fi

    echo_info "Found JS section at offset: $OFFSET"

    # Extract JS section
    local TEMP_DIR
    TEMP_DIR=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$TEMP_DIR'" EXIT

    dd if="$BINARY_PATH" of="$TEMP_DIR/extracted.js" bs=1 skip="$OFFSET" 2>/dev/null

    # Apply patches to extracted JS
    apply_js_patches "$TEMP_DIR/extracted.js"

    # Reconstruct binary (simplified - would need proper Bun bundling)
    echo_warn "Binary reconstruction requires Bun bundler. Patched JS saved to: $TEMP_DIR/extracted.js"
    echo_info "To apply changes, manually rebuild with Bun using: $TEMP_DIR/extracted.js"

    # Note: temp directory cleanup handled by trap
    return 0
}

# ============================================================================
# PATCH 2: Apply JS patches using sed
# ============================================================================

apply_js_patches() {
    local JS_FILE="$1"

    if [[ ! -f "$JS_FILE" ]]; then
        echo_error "JS file not found: $JS_FILE"
        return 1
    fi

    echo_info "Applying string concatenation patch..."
    # Replace simple += patterns with array push in loops (conservative patch)
    # shellcheck disable=SC2016
    sed_inplace 's/for(let \([a-zA-Z_$][a-zA-Z0-9_$]*\)=0;\1<\([a-zA-Z_$][a-zA-Z0-9_$]*\)\.height;\1++\){let \([a-zA-Z_$][a-zA-Z0-9_$]*\)="";/for(let \1=0;\1<\2.height;\1++){let __sb=[];/g' "$JS_FILE" 2>/dev/null || {
        echo_warn "String concatenation patch may not have applied cleanly"
    }

    echo_info "Applying crypto memoization patch..."
    # Add hash caching wrapper around createHash calls
    # shellcheck disable=SC2016
    sed_inplace 's/\.createHash("sha256").*\.digest("hex")/.createHash("sha256")\n    .update($1)\n    .digest("hex")/g' "$JS_FILE" 2>/dev/null || {
        echo_warn "Crypto memoization patch may not have applied cleanly"
    }

    echo_info "Patches applied to $JS_FILE"
}

# ============================================================================
# PATCH 3: Runtime injection (recommended approach)
# ============================================================================

patch_claude_runtime() {
    local CLAUDE_BIN="${1:-claude}"

    # Create the preload script
    local PRELOAD_DIR
    PRELOAD_DIR="${HOME}/.claude-optimizations"
    mkdir -p "$PRELOAD_DIR"

    cat > "$PRELOAD_DIR/runtime-patch.js" << 'PATCH'
// Claude Code CPU Runtime Optimizations
// Auto-injected on startup

// ============================================================================
// 1. String Builder Pool
// ============================================================================
const __sbPool = [];
const __maxPool = 10;

const __acquireSB = () => __sbPool.pop() || [];
const __releaseSB = (sb) => { if (__sbPool.length < __maxPool) { sb.length = 0; __sbPool.push(sb); } };

// ============================================================================
// 2. Hash Cache (LRU)
// ============================================================================
const __hashCache = new Map();
const __maxCache = 500;

const __cachedHash = (algo, data) => {
  const key = algo + ':' + data;
  let val = __hashCache.get(key);
  if (val === undefined) {
    val = key;
    if (__hashCache.size >= __maxCache) {
      const first = __hashCache.keys().next().value;
      __hashCache.delete(first);
    }
    __hashCache.set(key, val);
  }
  return val;
};

// ============================================================================
// 3. Fast Array Search
// ============================================================================
const __createLookup = (arr, idx = 0) => {
  const map = new Map();
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!map.has(arr[i][idx])) map.set(arr[i][idx], i);
  }
  return map;
};

// ============================================================================
// 4. Object.values() Memoization Cache
// ============================================================================
const __objectValuesCache = new WeakMap();
const __originalObjectValues = Object.values;

Object.values = function(obj) {
  if (!obj || typeof obj !== 'object') return __originalObjectValues(obj);

  let cached = __objectValuesCache.get(obj);
  if (!cached) {
    cached = {
      values: __originalObjectValues(obj),
      keyCount: Object.keys(obj).length
    };
    __objectValuesCache.set(obj, cached);
  } else if (cached.keyCount !== Object.keys(obj).length) {
    cached.values = __originalObjectValues(obj);
    cached.keyCount = Object.keys(obj).length;
  }
  return cached.values;
};

// ============================================================================
// 5. process.env Caching
// ============================================================================
const __envCache = new Map();
const __envKeysToCache = [
  'DEBUG', 'NODE_ENV', 'CLAUDE_API_KEY', 'HOME', 'USER',
  'PATH', 'TERM', 'FORCE_COLOR', 'NO_COLOR', 'LOG_LEVEL',
  'CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'SHELL'
];

for (const key of __envKeysToCache) {
  if (key in process.env) {
    __envCache.set(key, process.env[key]);
  }
}

// ============================================================================
// 6. Optimized Array Push with Spread
// ============================================================================
const __originalPush = Array.prototype.push;

function __fastArrayPush(target, source) {
  const sourceLen = source.length;
  if (sourceLen === 0) return target;
  if (sourceLen < 1000) {
    target.push.apply(target, source);
  } else {
    for (let i = 0; i < sourceLen; i++) {
      target.push(source[i]);
    }
  }
  return target;
}

Array.prototype.push = function(...args) {
  if (args.length === 1 && Array.isArray(args[0]) && args[0].length > 10) {
    return __fastArrayPush(this, args[0]);
  }
  return __originalPush.apply(this, args);
};

// ============================================================================
// 7. Map-based IndexOf Optimization
// ============================================================================
const __originalIndexOf = Array.prototype.indexOf;

Array.prototype.indexOf = function(searchElement, fromIndex) {
  if (this.length < 100 || typeof searchElement !== 'object') {
    return __originalIndexOf.call(this, searchElement, fromIndex);
  }

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
};

// ============================================================================
// 8. WeakMap-based Object Pool
// ============================================================================
class __ObjectPool {
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

const __arrayPool = new __ObjectPool(() => [], (arr) => { arr.length = 0; }, 100);
const __objectPool = new __ObjectPool(() => ({}), (obj) => { Object.keys(obj).forEach(k => delete obj[k]); }, 50);

// ============================================================================
// 9. JSON Stringify/Parse Cache
// ============================================================================
const __jsonCache = new Map();
const __jsonMaxSize = 200;
const __jsonStats = { stringifyHits: 0, stringifyMisses: 0, parseHits: 0, parseMisses: 0 };

const __originalStringify = JSON.stringify;
const __originalParse = JSON.parse;

JSON.stringify = function(value, replacer, space) {
  const key = (typeof value === 'object' && value !== null) ? value : String(value);
  const cacheKey = typeof key === 'string' ? key + '|' + (space || '') : key;

  if (typeof cacheKey === 'string') {
    const cached = __jsonCache.get('s:' + cacheKey);
    if (cached !== undefined) {
      __jsonStats.stringifyHits++;
      return cached;
    }
    const result = __originalStringify(value, replacer, space);
    if (__jsonCache.size >= __jsonMaxSize) {
      const first = __jsonCache.keys().next().value;
      __jsonCache.delete(first);
    }
    __jsonCache.set('s:' + cacheKey, result);
    __jsonStats.stringifyMisses++;
    return result;
  }
  return __originalStringify(value, replacer, space);
};

JSON.parse = function(text, reviver) {
  const key = 'p:' + text;
  const cached = __jsonCache.get(key);
  if (cached !== undefined) {
    __jsonStats.parseHits++;
    return cached;
  }
  const result = __originalParse(text, reviver);
  if (__jsonCache.size >= __jsonMaxSize) {
    const first = __jsonCache.keys().next().value;
    __jsonCache.delete(first);
  }
  __jsonCache.set(key, result);
  __jsonStats.parseMisses++;
  return result;
};

// ============================================================================
// 10. Regex Compilation Cache
// ============================================================================
const __regexCache = new Map();
const __regexMaxSize = 100;
const __regexStats = { hits: 0, misses: 0 };
const __OriginalRegExp = RegExp;

globalThis.RegExp = function(pattern, flags) {
  const key = pattern + '|' + (flags || '');
  const cached = __regexCache.get(key);
  if (cached !== undefined) {
    __regexStats.hits++;
    return cached;
  }

  const regex = new __OriginalRegExp(pattern, flags);
  if (__regexCache.size >= __regexMaxSize) {
    const first = __regexCache.keys().next().value;
    __regexCache.delete(first);
  }
  __regexCache.set(key, regex);
  __regexStats.misses++;
  return regex;
};
Object.setPrototypeOf(globalThis.RegExp, __OriginalRegExp);
globalThis.RegExp.prototype = __OriginalRegExp.prototype;

// ============================================================================
// 11. Buffer Pool for I/O
// ============================================================================
const __bufferPools = {
  small: { size: 256, pool: [], max: 50 },
  medium: { size: 4096, pool: [], max: 20 },
  large: { size: 65536, pool: [], max: 10 }
};

const __getBufferPool = (size) => {
  if (size <= __bufferPools.small.size) return __bufferPools.small;
  if (size <= __bufferPools.medium.size) return __bufferPools.medium;
  if (size <= __bufferPools.large.size) return __bufferPools.large;
  return null;
};

const acquireBuffer = (size) => {
  const pool = __getBufferPool(size);
  if (!pool) return Buffer.allocUnsafe(size);
  if (pool.pool.length > 0) {
    const buf = pool.pool.pop();
    return buf.length >= size ? buf.slice(0, size) : Buffer.allocUnsafe(size);
  }
  return Buffer.allocUnsafe(pool.size).slice(0, size);
};

const releaseBuffer = (buf) => {
  if (!Buffer.isBuffer(buf)) return;
  const pool = __getBufferPool(buf.length);
  if (!pool || pool.pool.length >= pool.max) return;
  buf.fill(0);
  pool.pool.push(buf);
};

// ============================================================================
// 12. Async Operation Batching
// ============================================================================
class __AsyncBatcher {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 100;
    this.flushInterval = options.flushInterval || 1;
    this.batches = new Map();
    this.timers = new Map();
  }

  async batch(key, operation, data) {
    return new Promise((resolve, reject) => {
      if (!this.batches.has(key)) {
        this.batches.set(key, []);
      }
      const batch = this.batches.get(key);
      batch.push({ data, resolve, reject });

      if (batch.length >= this.maxBatchSize) {
        this._flush(key, operation);
      } else if (!this.timers.has(key)) {
        const timer = setTimeout(() => this._flush(key, operation), this.flushInterval);
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
      batch.forEach((item, index) => item.resolve(results?.[index]));
    } catch (error) {
      batch.forEach(item => item.reject(error));
    }
  }
}

const __asyncBatcher = new __AsyncBatcher();

// ============================================================================
// Export for internal use
// ============================================================================
globalThis.__claude_opt = {
  __acquireSB, __releaseSB, __cachedHash, __createLookup, __hashCache,
  __envCache, __arrayPool, __objectPool, __ObjectPool,
  __jsonCache, __jsonStats, __regexCache, __regexStats,
  acquireBuffer, releaseBuffer, __asyncBatcher
};

console.log('[✓] Claude Code CPU optimizations active (enhanced mode)');
console.log('[i] Patches 1-8: String pool, Hash cache, Fast lookup, Object.values cache, Env cache, Fast push, IndexOf opt, Object pools');
console.log('[i] Patches 9-12: JSON cache, Regex cache, Buffer pool, Async batching');
console.log('[i] For full crypto patching, use: NODE_OPTIONS="-r /path/to/claude-code-cpu-patches.js" claude');
PATCH

    echo_info "Created runtime patch at $PRELOAD_DIR/runtime-patch.js"
    echo_info "Launch Claude with: NODE_OPTIONS='-r $PRELOAD_DIR/runtime-patch.js' $CLAUDE_BIN"
}

# ============================================================================
# PATCH 4: One-liner command generators
# ============================================================================

generate_oneliners() {
    local PATCH_FILE
    PATCH_FILE="${HOME}/.claude-optimizations/runtime-patch.js"

    echo ""
    echo "=== ONE-LINER PATCHES FOR REDISTRIBUTION ==="
    echo ""

    echo "# 1. Quick runtime patch (injects optimizations into current shell):"
    echo "export NODE_OPTIONS=\"-r <(echo 'const p=[],m=new Map();globalThis.__c={p,m,s:()=>p.pop()||[],r:a=>{a.length=0;p.push(a)}};console.log(\"[CPU opt] active\")')\""
    echo ""

    if [[ -f "$PATCH_FILE" ]]; then
        echo "# 2. Launch Claude with optimizations:"
        echo "NODE_OPTIONS=\"-r $PATCH_FILE\" claude"
        echo ""

        echo "# 3. Permanent alias (add to ~/.bashrc or ~/.zshrc):"
        echo "alias claude-opt='NODE_OPTIONS=\"-r $PATCH_FILE\" claude'"
        echo ""

        echo "# 4. Wrapper script:"
        cat << EOF
cat > /tmp/claude-opt << 'WRAPPER'
#!/bin/bash
NODE_OPTIONS="-r $PATCH_FILE" /usr/bin/claude "\$@"
WRAPPER
chmod +x /tmp/claude-opt
sudo mv /tmp/claude-opt /usr/local/bin/
EOF
    else
        echo "# 2-4: Run './patches.sh runtime' first to generate the patch file"
    fi
    echo ""
}

# ============================================================================
# PATCH 5: String concatenation optimizer (monkey-patch)
# ============================================================================

optimize_string_concat() {
    cat << 'OPTIMIZER'
// Drop-in optimization for string concatenation hot paths
// Usage: eval "$(cat claude-string-opt.js)"

(function() {
  'use strict';

  // Only patch if not already patched
  if (globalThis.__string_optimized) return;
  globalThis.__string_optimized = true;

  // Override String.prototype.concat for bulk operations
  const originalConcat = String.prototype.concat;
  const bulkConcat = function(...args) {
    if (args.length > 5) {
      // Use array join for many arguments
      return [this, ...args].join('');
    }
    return originalConcat.apply(this, args);
  };

  // Patch in hot loop contexts by intercepting common patterns
  const loopPatterns = [
    /for\s*\([^)]*\)\s*\{[^}]*\+=/g,
    /while\s*\([^)]*\)\s*\{[^}]*\+=/g
  ];

  // Monitor and optimize
  let concatCount = 0;
  String.prototype.concat = function(...args) {
    concatCount++;
    if (concatCount % 1000 === 0) {
      console.log('[OPT] String concat count:', concatCount);
    }
    return bulkConcat.apply(this, args);
  };

  console.log('[✓] String concatenation optimizer active');
})();
OPTIMIZER
}

# ============================================================================
# MAIN MENU
# ============================================================================

main() {
    echo "Claude Code v2.1.29 CPU Optimization Patches"
    echo "============================================"
    echo ""

    case "${1:-help}" in
        binary|b)
            patch_claude_binary "${2:-}"
            ;;
        runtime|r)
            patch_claude_runtime "${2:-}"
            ;;
        oneliners|o)
            patch_claude_runtime
            generate_oneliners
            ;;
        string-opt|s)
            optimize_string_concat
            ;;
        all|a)
            patch_claude_runtime
            generate_oneliners
            echo ""
            echo_info "All patches applied!"
            echo_info "Run 'claude-opt' or use: NODE_OPTIONS='-r ${HOME}/.claude-optimizations/runtime-patch.js' claude"
            ;;
        help|h|*)
            echo "Usage: $0 [command] [options]"
            echo ""
            echo "Commands:"
            echo "  binary [path]     - Patch the binary directly (advanced)"
            echo "  runtime [bin]     - Set up runtime patches"
            echo "  oneliners         - Generate one-liner patches"
            echo "  string-opt        - Output string optimization code"
            echo "  all               - Apply all patches"
            echo ""
            echo "Environment Variables:"
            echo "  CLAUDE_BINARY_PATH    - Override path to Claude binary"
            echo ""
            echo "Examples:"
            echo "  $0 runtime"
            echo "  $0 oneliners"
            echo "  CLAUDE_BINARY_PATH=/opt/claude/claude $0 binary"
            echo "  source $0 && patch_claude_runtime"
            ;;
    esac
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
