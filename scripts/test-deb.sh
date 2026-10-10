#!/usr/bin/env bash
#
# Validate a pi-coding-agent .deb package.
#
# Runs structural checks on the .deb file without requiring root or installing
# it system-wide. When run as root (e.g. in CI containers), also performs a
# full install/verify/remove cycle.
#
# Usage:
#   ./scripts/test-deb.sh <path-to-deb> [--expected-version <version>]
#
# Checks performed:
#   1. dpkg-deb --info succeeds and fields are present
#   2. dpkg-deb --contents lists expected paths
#   3. /usr/bin/pi symlink target is correct
#   4. lintian (if available) reports no errors
#   5. (root only) dpkg -i / pi --version / dpkg -r cycle

set -euo pipefail

DEB_PATH=""
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
            if [[ -z "$DEB_PATH" ]]; then
                DEB_PATH="$1"
            else
                echo "Unexpected argument: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$DEB_PATH" ]]; then
    echo "Usage: $0 <path-to-deb> [--expected-version <version>]" >&2
    exit 1
fi

if [[ ! -f "$DEB_PATH" ]]; then
    echo "FAIL: file not found: $DEB_PATH" >&2
    exit 1
fi

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

# ---------- 1. Package metadata ----------

echo "==> Checking package metadata..."
INFO="$(dpkg-deb --info "$DEB_PATH")" || { fail "dpkg-deb --info failed"; exit 1; }

for field in Package Version Architecture Maintainer Description; do
    if echo "$INFO" | grep -q "^ $field:"; then
        pass "field '$field' present"
    else
        fail "field '$field' missing from control"
    fi
done

PKG_NAME="$(echo "$INFO" | sed -n 's/^ Package: //p')"
if [[ "$PKG_NAME" == "pi-coding-agent" ]]; then
    pass "package name is pi-coding-agent"
else
    fail "package name is '$PKG_NAME', expected 'pi-coding-agent'"
fi

PKG_VERSION="$(echo "$INFO" | sed -n 's/^ Version: //p')"
if [[ -n "$EXPECTED_VERSION" ]]; then
    # Strip the debian revision for comparison
    UPSTREAM_VERSION="${PKG_VERSION%-*}"
    if [[ "$UPSTREAM_VERSION" == "$EXPECTED_VERSION" ]]; then
        pass "version matches expected ($EXPECTED_VERSION)"
    else
        fail "version is '$UPSTREAM_VERSION', expected '$EXPECTED_VERSION'"
    fi
fi

PKG_ARCH="$(echo "$INFO" | sed -n 's/^ Architecture: //p')"
case "$PKG_ARCH" in
    amd64|arm64) pass "architecture is valid ($PKG_ARCH)" ;;
    *) fail "unexpected architecture: $PKG_ARCH" ;;
esac

# ---------- 2. Package contents ----------

echo ""
echo "==> Checking package contents..."
CONTENTS="$(dpkg-deb --contents "$DEB_PATH")"

check_path() {
    local pattern="$1"
    local label="$2"
    if echo "$CONTENTS" | grep -qE "$pattern"; then
        pass "$label"
    else
        fail "$label not found in package"
    fi
}

check_path "./usr/lib/pi/pi$" "pi binary at /usr/lib/pi/pi"
check_path "./usr/bin/pi" "symlink at /usr/bin/pi"
check_path "./usr/lib/pi/photon_rs_bg.wasm" "photon wasm"
check_path "./usr/lib/pi/theme/" "theme directory"
check_path "./usr/lib/pi/assets/" "assets directory"
check_path "./usr/share/doc/pi-coding-agent/copyright" "copyright file"
check_path "./usr/share/doc/pi-coding-agent/changelog.Debian.gz" "debian changelog"

# Verify symlink target
echo ""
echo "==> Checking symlink target..."
SYMLINK_LINE="$(echo "$CONTENTS" | grep './usr/bin/pi' || true)"
if echo "$SYMLINK_LINE" | grep -q '/usr/lib/pi/pi'; then
    pass "symlink points to /usr/lib/pi/pi"
else
    fail "symlink target incorrect: $SYMLINK_LINE"
fi

# ---------- 3. Lintian ----------

echo ""
echo "==> Running lintian (if available)..."
if command -v lintian >/dev/null 2>&1; then
    # Run lintian; allow warnings but fail on errors.
    # --suppress-tags: binary-without-manpage is expected (pi has --help),
    # unstripped-binary-or-object is expected (Bun-compiled standalone).
    LINTIAN_TAGS_TO_SUPPRESS="binary-without-manpage,unstripped-binary-or-object,executable-not-elf-or-script,elf-error,hardening-no-fortify-functions,hardening-no-pie,shared-library-lacks-prerequisites,library-not-linked-against-libc,statically-linked-binary"
    if lintian --suppress-tags "$LINTIAN_TAGS_TO_SUPPRESS" --no-tag-display-limit "$DEB_PATH" 2>&1; then
        pass "lintian found no errors"
    else
        # lintian exits non-zero on errors; warnings are OK
        if lintian --suppress-tags "$LINTIAN_TAGS_TO_SUPPRESS" --no-tag-display-limit --fail-on error "$DEB_PATH" 2>&1; then
            pass "lintian found warnings but no errors"
        else
            fail "lintian reported errors"
        fi
    fi
else
    echo "SKIP: lintian not installed"
fi

# ---------- 4. Install/remove cycle (root only) ----------

echo ""
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    echo "==> Running install/remove cycle (running as root)..."
    dpkg -i "$DEB_PATH"

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

    dpkg -r pi-coding-agent
    if ! command -v pi >/dev/null 2>&1; then
        pass "pi command removed after dpkg -r"
    else
        fail "pi command still present after dpkg -r"
    fi
else
    echo "SKIP: install/remove cycle (not running as root)"
    echo "      Run as root or in a container to test installation."
fi

# ---------- Summary ----------

echo ""
echo "==> Results: $PASS passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
