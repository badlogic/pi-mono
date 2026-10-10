#!/usr/bin/env bash
#
# Build a .deb package from an extracted pi binary directory.
#
# The input is an extracted platform directory produced by build-binaries.sh,
# containing the standalone pi binary and all supporting files (wasm, themes,
# assets, export-html, native prebuilds, docs, examples).
#
# Usage:
#   ./scripts/build-deb.sh --input <extracted-dir> --arch <amd64|arm64> --version <version> [--out <dir>]
#
# Options:
#   --input <dir>      Extracted binary directory (e.g. packages/coding-agent/binaries/linux-x64)
#   --arch <arch>      Debian architecture: amd64 or arm64
#   --version <ver>    Package version (semver without leading v, e.g. 1.1.0)
#   --out <dir>        Output directory for the .deb file (default: .)
#   --revision <rev>   Package revision (default: 1)
#
# Output:
#   pi-coding-agent_<version>-<revision>_<arch>.deb
#
# The package installs:
#   /usr/lib/pi/          -- binary and all supporting files
#   /usr/bin/pi           -- symlink to /usr/lib/pi/pi
#   /usr/share/doc/pi-coding-agent/ -- copyright and changelog

set -euo pipefail

INPUT_DIR=""
ARCH=""
VERSION=""
OUT_DIR="."
REVISION="1"

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
        --revision)
            REVISION="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$INPUT_DIR" || -z "$ARCH" || -z "$VERSION" ]]; then
    echo "Usage: $0 --input <dir> --arch <amd64|arm64> --version <version>" >&2
    exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
    echo "Input directory does not exist: $INPUT_DIR" >&2
    exit 1
fi

case "$ARCH" in
    amd64|arm64) ;;
    *)
        echo "Invalid architecture: $ARCH (must be amd64 or arm64)" >&2
        exit 1
        ;;
esac

# Verify the pi binary exists
if [[ ! -f "$INPUT_DIR/pi" ]]; then
    echo "pi binary not found in $INPUT_DIR" >&2
    exit 1
fi

VERSION="${VERSION#v}"

PACKAGE_NAME="pi-coding-agent"
DEB_FILE="${PACKAGE_NAME}_${VERSION}-${REVISION}_${ARCH}.deb"

# Create staging directory
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

LIB_DIR="$STAGING/usr/lib/pi"
BIN_DIR="$STAGING/usr/bin"
DOC_DIR="$STAGING/usr/share/doc/$PACKAGE_NAME"
DEBIAN_DIR="$STAGING/DEBIAN"

mkdir -p "$LIB_DIR" "$BIN_DIR" "$DOC_DIR" "$DEBIAN_DIR"

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

# Compute installed size in KiB (dpkg convention)
INSTALLED_SIZE=$(du -sk "$STAGING" | cut -f1)

# Write the control file
cat > "$DEBIAN_DIR/control" <<EOF
Package: $PACKAGE_NAME
Version: ${VERSION}-${REVISION}
Architecture: $ARCH
Maintainer: Earendil Works <packages@earendil.works>
Installed-Size: $INSTALLED_SIZE
Depends:
Section: devel
Priority: optional
Homepage: https://pi.dev
Description: Coding agent CLI with read, bash, edit, write tools and session management
 Pi is an AI coding agent that runs in your terminal. It has read, bash,
 edit, and write tools with full session management. Pi works with multiple
 AI providers and supports both interactive and headless operation modes.
EOF

# Write copyright file
cat > "$DOC_DIR/copyright" <<EOF
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: pi-coding-agent
Upstream-Contact: Earendil Works <packages@earendil.works>
Source: https://github.com/earendil-works/pi

Files: *
Copyright: Earendil Works
License: Apache-2.0

License: Apache-2.0
 Licensed under the Apache License, Version 2.0.
 On Debian systems, the full text of the Apache License version 2.0
 can be found in /usr/share/common-licenses/Apache-2.0.
EOF

# Write a minimal changelog
cat > "$DOC_DIR/changelog.Debian" <<EOF
$PACKAGE_NAME ($VERSION-$REVISION) unstable; urgency=low

  * Package pi-coding-agent $VERSION as a Debian package.

 -- Earendil Works <packages@earendil.works>  $(date -R)
EOF
gzip -9n "$DOC_DIR/changelog.Debian"

# Copy upstream changelog if available
if [[ -f "$INPUT_DIR/CHANGELOG.md" ]]; then
    cp "$INPUT_DIR/CHANGELOG.md" "$DOC_DIR/changelog"
    gzip -9n "$DOC_DIR/changelog"
fi

# Set correct permissions
find "$STAGING" -type d -exec chmod 755 {} +
find "$STAGING/usr" -type f -not -name "pi" -exec chmod 644 {} +
chmod 755 "$LIB_DIR/pi"
# Fix permissions on native prebuilds (shared libraries need to be executable)
if [[ -d "$LIB_DIR/native" ]]; then
    find "$LIB_DIR/native" -name "*.node" -exec chmod 755 {} +
fi

# Build the package
mkdir -p "$OUT_DIR"
dpkg-deb --build --root-owner-group "$STAGING" "$OUT_DIR/$DEB_FILE"

echo "Built: $OUT_DIR/$DEB_FILE"
