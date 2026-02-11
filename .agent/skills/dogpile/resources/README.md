# Dogpile Resource Registry

Dynamic, extensible registry of research resources for the dogpile skill.

## For Agents: Use Presets

**Don't think about 100+ individual resources. Pick ONE preset that matches your goal:**

```bash
# List available presets
dogpile presets

# Use a preset
dogpile search "CVE-2024-1234" --preset vulnerability_research
dogpile search "privesc linux" --preset red_team
dogpile search "detect mimikatz" --preset blue_team

# Auto-detect preset from query
dogpile search "CVE-2024-1234" --auto-preset
```

### Preset Quick Reference

| User Intent                          | Preset                 |
|--------------------------------------|------------------------|
| "What is CVE-2024-1234?"             | `vulnerability_research` |
| "How to escalate privs on Linux"     | `red_team`               |
| "Write a Sigma rule for X"           | `blue_team`              |
| "Info on APT29 techniques"           | `threat_intel`           |
| "Analyze this malware hash"          | `malware_analysis`       |
| "What's exposed on example.com"      | `osint`                  |
| "Harden my Docker containers"        | `container_security`     |
| "Analyze this PCAP"                  | `network_analysis`       |
| "Latest zero-days this week"         | `bleeding_edge`          |
| "What's the community saying about X"| `community`              |
| "How does React hooks work?"         | `general`                |

### How Presets Work

1. **Brave Search with site: filters** - Each preset defines domains to search
2. **Direct API calls** - For resources with APIs (NVD, CISA KEV, etc.)
3. **Default sources** - GitHub, ArXiv, YouTube still searched unless `include_defaults: false`

## Python API

```python
from resources.resource_registry import get_registry

registry = get_registry()

# Get all red team resources
red_team = registry.red_team()

# Get vulnerability databases
vulns = registry.vulnerability_intel()

# Search for something specific
docker_sec = registry.search("docker security")

# Use presets
preset = registry.get_preset("red_team")
brave_query = preset.get_brave_query("linux privesc")
# Returns: "linux privesc (site:gtfobins.github.io OR site:lolbas-project.github.io OR ...)"
```

## CLI Usage

```bash
# Show statistics
python resources/resource_registry.py --stats

# Get security resources as JSON
python resources/resource_registry.py --category security --json

# Get red team resources
python resources/resource_registry.py --tags red_team

# Search for malware resources
python resources/resource_registry.py --search malware

# Get free resources only (no auth required)
python resources/resource_registry.py --free

# Output as markdown table
python resources/resource_registry.py --category security --markdown
```

## Adding New Resources

### 1. Create a YAML file

Create a new file in `resources/` with the `.yaml` extension:

```yaml
# resources/my_resources.yaml
version: "1.0"
category: my_category

resources:
  - name: My Resource
    url: https://example.com
    api_url: https://api.example.com/v1  # Optional
    type: api  # api, feed, scrape, archive, database
    method: GET  # GET, POST, RSS
    tags: [red_team, osint, recon]
    rate_limit: 30  # requests per minute, 0 = unknown
    auth_required: false
    description: What this resource provides
```

### 2. Resource Types

| Type       | Description                     | Example              |
| ---------- | ------------------------------- | -------------------- |
| `api`      | REST API with structured data   | NVD, GitHub          |
| `feed`     | RSS/Atom/JSON feed              | CISA KEV, ArXiv      |
| `scrape`   | Web scraping required           | GTFOBins, HackTricks |
| `archive`  | File/sample archive             | VX-Underground       |
| `database` | Searchable database             | Exploit-DB           |

### 3. Common Tags

**Team Tags:**
- `red_team` - Offensive security
- `blue_team` - Defensive security

**Content Tags:**
- `vulns` - Vulnerability data
- `exploits` - Exploit code/PoCs
- `malware` - Malware samples/analysis
- `threat_intel` - Threat intelligence
- `osint` - Open source intelligence
- `detection` - Detection rules/signatures
- `poc` - Proof of concept code

**Source Tags:**
- `api` - Has API access
- `free` - No cost
- `paid` - Requires payment

## File Naming

- `default.yaml` - Core dogpile sources (always loaded)
- `security.yaml` - Security research resources
- `_disabled.yaml` - Files starting with `_` are skipped

## API Reference

```python
class ResourceRegistry:
    # Load/reload
    def load_all(directory: Path = None) -> None
    def reload() -> None

    # Query methods
    def all() -> list[Resource]
    def by_category(category: str) -> list[Resource]
    def by_tags(tags: list[str], match_all: bool = False) -> list[Resource]
    def by_type(resource_type: str) -> list[Resource]
    def free_only() -> list[Resource]
    def with_api() -> list[Resource]
    def search(query: str) -> list[Resource]

    # Convenience methods
    def red_team() -> list[Resource]
    def blue_team() -> list[Resource]
    def vulnerability_intel() -> list[Resource]
    def threat_intel() -> list[Resource]
    def osint() -> list[Resource]
    def detection() -> list[Resource]

    # Utility
    def get_all_tags() -> set[str]
    def get_categories() -> list[str]
    def stats() -> dict[str, Any]
    def to_markdown_table(resources: list[Resource] = None) -> str
```

## Integration with Dogpile

The registry is used by dogpile to dynamically select search sources:

```python
from resources.resource_registry import get_registry

def build_security_search(query: str):
    registry = get_registry()

    # Get relevant resources based on query analysis
    if "exploit" in query.lower():
        sources = registry.vulnerability_intel()
    elif "detect" in query.lower():
        sources = registry.detection()
    else:
        sources = registry.by_category("security")

    # Filter to free APIs only
    sources = [s for s in sources if not s.auth_required and s.api_url]

    return sources
```

## Examples

### Security Audit Research

```python
registry = get_registry()

# Get vulnerability databases
vulns = registry.by_tags(["vulns", "cve", "exploits"])

# Get detection resources
detection = registry.by_tags(["detection", "rules", "yara"])

# Get threat intel
intel = registry.threat_intel()
```

### Red Team Operation

```python
registry = get_registry()

# Get offensive resources
red = registry.red_team()

# Exclude resources requiring auth
free_red = [r for r in red if not r.auth_required]

# Get OSINT sources
osint = registry.osint()
```

### Blue Team Defense

```python
registry = get_registry()

# Get defensive resources
blue = registry.blue_team()

# Get malware analysis resources
malware = registry.by_tags(["malware", "sandbox", "analysis"])

# Get SIEM/detection resources
siem = registry.by_tags(["detection", "siem", "rules"])
```
