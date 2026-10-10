#!/usr/bin/env bash
#
# Build an .rpm package from an extracted pi binary directory.
#
# The input is an extracted platform directory produced by build-binaries.sh,
# containing the standalone pi binary and all supporting files (wasm, themes,
# assets, export-html, native prebuilds, docs, examples).
#
# Usage:
#   ./scripts/build-rpm.sh --input <extracted-dir> --arch <x86_64|aarch64> --version <version> [--out <dir>]
#
# Options:
#   --input <dir>      Extracted binary directory (e.g. packages/coding-agent/binaries/linux-x64)
#   --arch <arch>      RPM architecture: x86_64 or aarch64
#   --version <ver>    Package version (semver without leading v, e.g. 1.1.0)
#   --out <dir>        Output directory for the .rpm file (default: .)
#   --release <rel>    Package release number (default: 1)
#
# Output:
#   pi-coding-agent-<version>-<release>.<arch>.rpm
#
# The package installs:
#   /usr/lib/pi/          -- binary and all supporting files
#   /usr/bin/pi           -- symlink to /usr/lib/pi/pi
#   /usr/share/doc/pi-coding-agent/ -- license and changelog
#
# Dependencies:
#   rpmbuild (from rpm-build package)

set -euo pipefail

INPUT_DIR=""
ARCH=""
VERSION=""
OUT_DIR="."
RELEASE="1"

while [[ $# -gt 0 ]]; do
    case $1 in
        --input)
            INPUT_DIR="$2"
            shift 2
            ;;
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --out)
            OUT_DIR="$2"
            shift 2
            ;;
        --release)
            RELEASE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$INPUT_DIR" || -z "$ARCH" || -z "$VERSION" ]]; then
    echo "Usage: $0 --input <dir> --arch <x86_64|aarch64> --version <version>" >&2
    exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
    echo "Input directory does not exist: $INPUT_DIR" >&2
    exit 1
fi

case "$ARCH" in
    x86_64|aarch64) ;;
    *)
        echo "Invalid architecture: $ARCH (must be x86_64 or aarch64)" >&2
        exit 1
        ;;
esac

if [[ ! -f "$INPUT_DIR/pi" ]]; then
    echo "pi binary not found in $INPUT_DIR" >&2
    exit 1
fi

if ! command -v rpmbuild >/dev/null 2>&1; then
    echo "rpmbuild not found. Install rpm-build: sudo apt-get install rpm or sudo dnf install rpm-build" >&2
    exit 1
fi

VERSION="${VERSION#v}"

PACKAGE_NAME="pi-coding-agent"

# Resolve absolute paths
INPUT_DIR="$(cd "$INPUT_DIR" && pwd)"
if [[ "$OUT_DIR" != /* ]]; then
    OUT_DIR="$(pwd)/$OUT_DIR"
fi
mkdir -p "$OUT_DIR"

# Create rpmbuild directory structure
RPMBUILD="$(mktemp -d)"
trap 'rm -rf "$RPMBUILD"' EXIT
mkdir -p "$RPMBUILD"/{BUILD,RPMS,SOURCES,SPECS,SRPMS,BUILDROOT}

# Create the install tree in BUILDROOT
BUILDROOT="$RPMBUILD/BUILDROOT/${PACKAGE_NAME}-${VERSION}-${RELEASE}.${ARCH}"
LIB_DIR="$BUILDROOT/usr/lib/pi"
BIN_DIR="$BUILDROOT/usr/bin"
DOC_DIR="$BUILDROOT/usr/share/doc/$PACKAGE_NAME"

mkdir -p "$LIB_DIR" "$BIN_DIR" "$DOC_DIR"

# Copy the pi binary
cp "$INPUT_DIR/pi" "$LIB_DIR/pi"
chmod 755 "$LIB_DIR/pi"

# Copy supporting files
if [[ -f "$INPUT_DIR/photon_rs_bg.wasm" ]]; then
    cp "$INPUT_DIR/photon_rs_bg.wasm" "$LIB_DIR/"
fi

for dir in theme assets export-html docs examples; do
    if [[ -d "$INPUT_DIR/$dir" ]]; then
        cp -r "$INPUT_DIR/$dir" "$LIB_DIR/"
    fi
done

# Copy native prebuilds if present
if [[ -d "$INPUT_DIR/native" ]]; then
    cp -r "$INPUT_DIR/native" "$LIB_DIR/"
fi

# Create symlink: /usr/bin/pi -> /usr/lib/pi/pi
ln -s /usr/lib/pi/pi "$BIN_DIR/pi"

# License file
cat > "$DOC_DIR/LICENSE" <<'EOF'
Licensed under the Apache License, Version 2.0.
See https://www.apache.org/licenses/LICENSE-2.0
EOF

# Copy upstream changelog if available
if [[ -f "$INPUT_DIR/CHANGELOG.md" ]]; then
    cp "$INPUT_DIR/CHANGELOG.md" "$DOC_DIR/"
fi

# Collect all installed files for the %files section.
# Paths are relative to BUILDROOT and must be absolute (leading /).
FILES_LIST="$RPMBUILD/files.txt"
(cd "$BUILDROOT" && find . -type f -o -type l) | sed 's|^\.|/|' | sort > "$FILES_LIST"

# Collect directories we own (everything under /usr/lib/pi and /usr/share/doc/pi-coding-agent)
DIRS_LIST="$RPMBUILD/dirs.txt"
(cd "$BUILDROOT" && find ./usr/lib/pi -type d && find ./usr/share/doc/$PACKAGE_NAME -type d) | sed 's|^\.|%dir /|' | sort > "$DIRS_LIST"

# Write the spec file
cat > "$RPMBUILD/SPECS/${PACKAGE_NAME}.spec" <<EOF
Name:           ${PACKAGE_NAME}
Version:        ${VERSION}
Release:        ${RELEASE}%{?dist}
Summary:        Coding agent CLI with read, bash, edit, write tools and session management
License:        Apache-2.0
URL:            https://pi.dev
Group:          Development/Tools

# Disable debug package generation (standalone binary, no debuginfo)
%define debug_package %{nil}

# Disable binary stripping (Bun-compiled standalone)
%define __strip /bin/true

# Disable automatic dependency scanning (standalone binary has no shared lib deps)
AutoReqProv:    no

%description
Pi is an AI coding agent that runs in your terminal. It has read, bash,
edit, and write tools with full session management. Pi works with multiple
AI providers and supports both interactive and headless operation modes.

# No %prep, %build, or %install -- we use a pre-populated BUILDROOT

%files
$(cat "$DIRS_LIST")
$(cat "$FILES_LIST")
EOF

# Build the RPM
rpmbuild \
    --define "_topdir $RPMBUILD" \
    --define "_rpmdir $RPMBUILD/RPMS" \
    --define "buildroot $BUILDROOT" \
    --target "$ARCH" \
    -bb "$RPMBUILD/SPECS/${PACKAGE_NAME}.spec"

# Copy the RPM to the output directory
RPM_FILE=$(find "$RPMBUILD/RPMS" -name "*.rpm" -type f | head -1)
if [[ -z "$RPM_FILE" ]]; then
    echo "RPM build produced no output" >&2
    exit 1
fi

cp "$RPM_FILE" "$OUT_DIR/"
RPM_BASENAME="$(basename "$RPM_FILE")"
echo "Built: $OUT_DIR/$RPM_BASENAME"
