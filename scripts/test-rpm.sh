#!/usr/bin/env bash
#
# Validate a pi-coding-agent .rpm package.
#
# Runs structural checks on the .rpm file without requiring root or installing
# it system-wide. When run as root inside an RPM-based container (e.g. Fedora,
# Rocky), also performs a full install/verify/remove cycle.
#
# Usage:
#   ./scripts/test-rpm.sh <path-to-rpm> [--expected-version <version>]
#
# Checks performed:
#   1. rpm -qip succeeds and fields are present
#   2. rpm -qlp lists expected paths
#   3. /usr/bin/pi symlink target is correct
#   4. rpmlint (if available) reports no errors
#   5. (root only, rpm-based OS) rpm -ivh / pi --version / rpm -e cycle

set -euo pipefail

RPM_PATH=""
EXPECTED_VERSION=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --expected-version)
            EXPECTED_VERSION="$2"
            shift 2
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$RPM_PATH" ]]; then
                RPM_PATH="$1"
            else
                echo "Unexpected argument: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$RPM_PATH" ]]; then
    echo "Usage: $0 <path-to-rpm> [--expected-version <version>]" >&2
    exit 1
fi

if [[ ! -f "$RPM_PATH" ]]; then
    echo "FAIL: file not found: $RPM_PATH" >&2
    exit 1
fi

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

# ---------- 1. Package metadata ----------

echo "==> Checking package metadata..."
INFO="$(rpm -qip "$RPM_PATH" 2>/dev/null)" || { fail "rpm -qip failed"; exit 1; }

for field in Name Version Release Architecture License URL Summary; do
    if echo "$INFO" | grep -qi "^${field}"; then
        pass "field '$field' present"
    else
        fail "field '$field' missing from package info"
    fi
done

PKG_NAME="$(echo "$INFO" | grep -i '^Name' | awk '{print $NF}')"
if [[ "$PKG_NAME" == "pi-coding-agent" ]]; then
    pass "package name is pi-coding-agent"
else
    fail "package name is '$PKG_NAME', expected 'pi-coding-agent'"
fi

PKG_VERSION="$(echo "$INFO" | grep -i '^Version' | awk '{print $NF}')"
if [[ -n "$EXPECTED_VERSION" ]]; then
    if [[ "$PKG_VERSION" == "$EXPECTED_VERSION" ]]; then
        pass "version matches expected ($EXPECTED_VERSION)"
    else
        fail "version is '$PKG_VERSION', expected '$EXPECTED_VERSION'"
    fi
fi

PKG_ARCH="$(echo "$INFO" | grep -i '^Architecture' | awk '{print $NF}')"
case "$PKG_ARCH" in
    x86_64|aarch64) pass "architecture is valid ($PKG_ARCH)" ;;
    *) fail "unexpected architecture: $PKG_ARCH" ;;
esac

PKG_LICENSE="$(echo "$INFO" | grep -i '^License' | sed 's/^[^:]*: *//')"
if echo "$PKG_LICENSE" | grep -qi "apache"; then
    pass "license is Apache"
else
    fail "license is '$PKG_LICENSE', expected Apache-2.0"
fi

# ---------- 2. Package contents ----------

echo ""
echo "==> Checking package contents..."
CONTENTS="$(rpm -qlp "$RPM_PATH" 2>/dev/null)"

check_path() {
    local pattern="$1"
    local label="$2"
    if echo "$CONTENTS" | grep -qE "$pattern"; then
        pass "$label"
    else
        fail "$label not found in package"
    fi
}

check_path "^/usr/lib/pi/pi$" "pi binary at /usr/lib/pi/pi"
check_path "^/usr/bin/pi$" "symlink at /usr/bin/pi"
check_path "^/usr/lib/pi/photon_rs_bg.wasm$" "photon wasm"
check_path "^/usr/lib/pi/theme/" "theme directory"
check_path "^/usr/lib/pi/assets/" "assets directory"
check_path "^/usr/share/doc/pi-coding-agent/LICENSE$" "license file"

# ---------- 3. Verify symlink ----------

echo ""
echo "==> Checking symlink in package..."
# Extract the cpio payload and check the symlink target
EXTRACT_DIR="$(mktemp -d)"
trap 'rm -rf "$EXTRACT_DIR"' EXIT

# rpm2cpio + cpio is the standard way to inspect without installing
if command -v rpm2cpio >/dev/null 2>&1; then
    (cd "$EXTRACT_DIR" && rpm2cpio "$RPM_PATH" | cpio -idm 2>/dev/null)
    if [[ -L "$EXTRACT_DIR/usr/bin/pi" ]]; then
        LINK_TARGET="$(readlink "$EXTRACT_DIR/usr/bin/pi")"
        if [[ "$LINK_TARGET" == "/usr/lib/pi/pi" ]]; then
            pass "symlink points to /usr/lib/pi/pi"
        else
            fail "symlink target is '$LINK_TARGET', expected '/usr/lib/pi/pi'"
        fi
    else
        fail "/usr/bin/pi is not a symlink in the package"
    fi
else
    echo "SKIP: rpm2cpio not available for symlink inspection"
fi

# ---------- 4. rpmlint ----------

echo ""
echo "==> Running rpmlint (if available)..."
if command -v rpmlint >/dev/null 2>&1; then
    # rpmlint returns non-zero on warnings; capture output and check for errors
    RPMLINT_OUT="$(rpmlint "$RPM_PATH" 2>&1 || true)"
    echo "$RPMLINT_OUT"
    # Count errors (lines containing ': E: ')
    ERROR_COUNT="$(echo "$RPMLINT_OUT" | grep -c ': E: ' || true)"
    if [[ "$ERROR_COUNT" -eq 0 ]]; then
        pass "rpmlint found no errors"
    else
        # Some errors are expected for Bun-compiled standalone binaries
        EXPECTED_ERRORS="$(echo "$RPMLINT_OUT" | grep ': E: ' | grep -cE '(statically-linked-binary|position-independent-executable|binary-or-shlib-calls-gethostbyname|no-documentation|arch-dependent-file-in-usr-share)' || true)"
        UNEXPECTED="$((ERROR_COUNT - EXPECTED_ERRORS))"
        if [[ "$UNEXPECTED" -eq 0 ]]; then
            pass "rpmlint errors are all expected for standalone binary ($ERROR_COUNT suppressed)"
        else
            fail "rpmlint reported $UNEXPECTED unexpected error(s)"
        fi
    fi
else
    echo "SKIP: rpmlint not installed"
fi

# ---------- 5. Install/remove cycle (root only, rpm-based OS) ----------

echo ""
if [[ "${EUID:-$(id -u)}" -eq 0 ]] && command -v rpm >/dev/null 2>&1; then
    echo "==> Running install/remove cycle (running as root)..."

    # Check if we can actually install (need rpm database)
    rpm -ivh --test "$RPM_PATH" 2>/dev/null && RPM_TESTABLE=true || RPM_TESTABLE=false

    if [[ "$RPM_TESTABLE" == "true" ]]; then
        rpm -ivh "$RPM_PATH"

        if command -v pi >/dev/null 2>&1; then
            pass "pi command available after install"
        else
            fail "pi command not found after install"
        fi

        if pi --version >/dev/null 2>&1; then
            INSTALLED_VERSION="$(pi --version)"
            pass "pi --version succeeded: $INSTALLED_VERSION"
            if [[ -n "$EXPECTED_VERSION" && "$INSTALLED_VERSION" != "$EXPECTED_VERSION" ]]; then
                fail "installed version '$INSTALLED_VERSION' does not match expected '$EXPECTED_VERSION'"
            fi
        else
            fail "pi --version failed"
        fi

        if pi --help >/dev/null 2>&1; then
            pass "pi --help succeeded"
        else
            fail "pi --help failed"
        fi

        rpm -e pi-coding-agent
        if ! command -v pi >/dev/null 2>&1; then
            pass "pi command removed after rpm -e"
        else
            fail "pi command still present after rpm -e"
        fi
    else
        echo "SKIP: rpm --test failed (may not be an rpm-based OS)"
    fi
else
    echo "SKIP: install/remove cycle (not root or rpm not available)"
    echo "      Run inside a Fedora/Rocky container as root to test installation."
fi

# ---------- Summary ----------

echo ""
echo "==> Results: $PASS passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
