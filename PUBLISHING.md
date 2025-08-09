# Publishing Guide

## Publishing Workflow

### 1. Pre-publish Checks

```bash
# Clean everything and rebuild from scratch
npm run clean
npm run build

# Run all checks
npm run check

# Test packages work correctly
cd packages/agent && npx tsx src/cli.ts --help
cd packages/pods && npx tsx src/cli.ts --help
```

### 2. Version Bump

All packages use lockstep versioning (same version number):

```bash
# Patch version bump (0.5.0 -> 0.5.1)
npm run version:patch

# Minor version bump (0.5.0 -> 0.6.0)
npm run version:minor  

# Major version bump (0.5.0 -> 1.0.0)
npm run version:major
```

This automatically:
- Updates all package versions
- Syncs inter-package dependencies

### 3. Commit & Tag

```bash
# Commit the version bump
git add -A
git commit -m "Release v0.5.1"

# Tag the release
git tag -a v0.5.1 -m "Release v0.5.1"

# Push to GitHub
git push origin main --tags
```

### 4. Publish to npm

```bash
# Dry run first (see what would be published)
npm run publish:dry

# If everything looks good, publish for real
npm run publish:all
```

This will:
1. Clean all dist folders
2. Build all packages in dependency order
3. Run all checks
4. Publish all packages to npm with public access

### 5. Verify Publication

```bash
# Check npm registry
npm view @mariozechner/pi-tui
npm view @mariozechner/pi-agent  
npm view @mariozechner/pi

# Test installation
npx @mariozechner/pi --help
npx @mariozechner/pi-agent --help
```

## Notes

- All packages are published with `--access public` flag
- The `prepublishOnly` script in each package ensures clean builds
- Dependencies between packages use `^` version ranges for flexibility
- The monorepo itself (`pi-monorepo`) is private and not published