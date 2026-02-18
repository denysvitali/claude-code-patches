#!/bin/bash
# Claude Code v2.1.45 CPU Optimization Patches
# Generates runtime preload script and provides launch helpers
#
# Usage:
#   ./patches-2.1.45.sh runtime     # Generate preload script
#   ./patches-2.1.45.sh oneliners   # Show launch commands
#   ./patches-2.1.45.sh help        # Show help

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }
echo_step()  { echo -e "${CYAN}[STEP]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_SOURCE="${SCRIPT_DIR}/claude-code-cpu-patches-2.1.45.js"
OUTPUT_DIR="${HOME}/.claude-optimizations"
OUTPUT_FILE="${OUTPUT_DIR}/runtime-patch-2.1.45.js"

# ============================================================================
# Generate runtime preload script
# ============================================================================

generate_runtime_patch() {
    if [[ ! -f "$PATCH_SOURCE" ]]; then
        echo_error "Patch source not found: $PATCH_SOURCE"
        echo_error "Ensure claude-code-cpu-patches-2.1.45.js is in the same directory as this script."
        return 1
    fi

    mkdir -p "$OUTPUT_DIR"
    cp "$PATCH_SOURCE" "$OUTPUT_FILE"

    echo_info "Runtime patch generated at: $OUTPUT_FILE"
    echo ""
    echo_step "Launch Claude with patches:"
    echo "  NODE_OPTIONS='-r ${OUTPUT_FILE}' claude"
    echo ""
    echo_step "Or add a permanent alias to your shell rc file:"
    echo "  alias claude-opt='NODE_OPTIONS=\"-r ${OUTPUT_FILE}\" claude'"
    echo ""
    echo_step "Environment variables for tuning:"
    echo "  CLAUDE_PATCH_NO_TIMER_THROTTLE=1   # Disable 16ms→100ms timer throttle"
    echo "  CLAUDE_PATCH_MAX_HEAP_MB=4096       # Override remote-mode heap cap (default: 2048)"
    echo "  CLAUDE_CODE_ENABLE_TELEMETRY=1      # Keep OTel telemetry enabled"
}

# ============================================================================
# Show one-liner launch commands
# ============================================================================

show_oneliners() {
    echo ""
    echo "=== v2.1.45 LAUNCH COMMANDS ==="
    echo ""

    if [[ -f "$OUTPUT_FILE" ]]; then
        echo "# 1. Launch Claude with all patches:"
        echo "NODE_OPTIONS='-r ${OUTPUT_FILE}' claude"
        echo ""

        echo "# 2. Permanent alias (add to ~/.bashrc or ~/.zshrc):"
        echo "alias claude-opt='NODE_OPTIONS=\"-r ${OUTPUT_FILE}\" claude'"
        echo ""

        echo "# 3. With timer throttle disabled (if animation feels laggy):"
        echo "CLAUDE_PATCH_NO_TIMER_THROTTLE=1 NODE_OPTIONS='-r ${OUTPUT_FILE}' claude"
        echo ""

        echo "# 4. Wrapper script:"
        echo "cat > /tmp/claude-opt << 'WRAPPER'"
        echo "#!/bin/bash"
        echo "NODE_OPTIONS=\"-r ${OUTPUT_FILE}\" claude \"\$@\""
        echo "WRAPPER"
        echo "chmod +x /tmp/claude-opt && sudo mv /tmp/claude-opt /usr/local/bin/"
        echo ""
    else
        echo "Run './patches-2.1.45.sh runtime' first to generate the patch file."
    fi
}

# ============================================================================
# Verify patches are working
# ============================================================================

verify_patches() {
    if [[ ! -f "$OUTPUT_FILE" ]]; then
        echo_error "Patch file not found. Run './patches-2.1.45.sh runtime' first."
        return 1
    fi

    echo_info "Verifying patch file exists: $OUTPUT_FILE"
    echo_info "File size: $(wc -c < "$OUTPUT_FILE") bytes"
    echo ""
    echo_step "To verify patches are loaded at runtime:"
    echo "  1. Launch: NODE_OPTIONS='-r ${OUTPUT_FILE}' claude"
    echo "  2. Look for: '[v2.1.45 patch] Loaded — 8 patches active'"
    echo "  3. Look for: '[v2.1.45 patch] Intercepted setInterval(Bun.gc, ...)'"
    echo ""
    echo_step "To measure CPU improvement:"
    echo "  # Before (unpatched):"
    echo "  claude &"
    echo "  top -p \$(pgrep -f claude)"
    echo ""
    echo "  # After (patched):"
    echo "  NODE_OPTIONS='-r ${OUTPUT_FILE}' claude &"
    echo "  top -p \$(pgrep -f claude)"
}

# ============================================================================
# Main
# ============================================================================

main() {
    echo "Claude Code v2.1.45 CPU Optimization Patches"
    echo "============================================="
    echo ""

    case "${1:-help}" in
        runtime|r)
            generate_runtime_patch
            ;;
        oneliners|o)
            generate_runtime_patch
            show_oneliners
            ;;
        verify|v)
            verify_patches
            ;;
        all|a)
            generate_runtime_patch
            show_oneliners
            echo ""
            echo_info "All done! Run: NODE_OPTIONS='-r ${OUTPUT_FILE}' claude"
            ;;
        help|h|*)
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  runtime     Generate the runtime preload patch file"
            echo "  oneliners   Generate patch file + show launch commands"
            echo "  verify      Check that patch file is in place"
            echo "  all         Generate everything + show commands"
            echo "  help        Show this help"
            echo ""
            echo "Patches applied (ordered by impact):"
            echo "  1. Neutralize forced GC interval      (CRITICAL)"
            echo "  2. Throttle 16ms animation timer       (MEDIUM)"
            echo "  3. Cap heap size in remote mode         (MEDIUM)"
            echo "  4. Disable telemetry loading            (LOW)"
            echo "  5. process.env snapshot cache           (MEDIUM)"
            echo "  6. crypto.createHash cache              (MEDIUM)"
            echo "  7. JSON.stringify/parse cache           (LOW)"
            echo "  8. RegExp compilation cache             (LOW)"
            echo ""
            echo "Environment variables:"
            echo "  CLAUDE_PATCH_NO_TIMER_THROTTLE=1   Disable timer throttle"
            echo "  CLAUDE_PATCH_MAX_HEAP_MB=N          Override remote heap cap"
            echo "  CLAUDE_CODE_ENABLE_TELEMETRY=1     Keep telemetry enabled"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
