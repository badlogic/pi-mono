#!/usr/bin/env python3
"""
Resource Registry for Dogpile

Dynamically loads and queries research resources from YAML configuration files.
Supports filtering by tags, category, authentication requirements, etc.

Usage:
    from resources.resource_registry import ResourceRegistry

    registry = ResourceRegistry()

    # Get all security resources
    security = registry.by_category("security")

    # Get red team resources only
    red_team = registry.by_tags(["red_team"])

    # Get free resources (no auth required)
    free = registry.free_only()

    # Get resources for a specific use case
    vulns = registry.search("vulnerability database")
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

RESOURCES_DIR = Path(__file__).parent


@dataclass
class Preset:
    """A curated group of resources for a specific research scenario."""

    name: str
    description: str
    use_when: list[str]
    resources: list[str]  # Resource names
    brave_sites: list[str]  # Domains for Brave site: filter
    api_resources: list[str]  # Resources with direct API access
    include_defaults: bool = True

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> Preset:
        """Create a Preset from a dictionary."""
        return cls(
            name=name,
            description=data.get("description", ""),
            use_when=data.get("use_when", []),
            resources=data.get("resources", []),
            brave_sites=data.get("brave_sites", []),
            api_resources=data.get("api_resources", []),
            include_defaults=data.get("include_defaults", True),
        )

    def get_brave_query(self, query: str, max_sites: int = 5) -> str:
        """
        Build a Brave search query with site: filters.

        Args:
            query: The search query
            max_sites: Maximum number of site filters (Brave has limits)

        Returns:
            Query string like: "CVE-2024-1234 (site:exploit-db.com OR site:nvd.nist.gov)"
        """
        if not self.brave_sites:
            return query

        sites = self.brave_sites[:max_sites]
        site_filter = " OR ".join(f"site:{s}" for s in sites)
        return f"{query} ({site_filter})"


@dataclass
class Resource:
    """A single research resource."""

    name: str
    url: str
    type: str  # api, feed, scrape, archive, database
    method: str  # GET, POST, RSS
    tags: list[str]
    description: str
    api_url: str | None = None
    rate_limit: int = 0  # requests per minute, 0 = unknown
    auth_required: bool = False
    category: str = "default"

    @classmethod
    def from_dict(cls, data: dict[str, Any], category: str = "default") -> Resource:
        """Create a Resource from a dictionary."""
        return cls(
            name=data.get("name", "Unknown"),
            url=data.get("url", ""),
            api_url=data.get("api_url"),
            type=data.get("type", "scrape"),
            method=data.get("method", "GET"),
            tags=data.get("tags", []),
            rate_limit=data.get("rate_limit", 0),
            auth_required=data.get("auth_required", False),
            description=data.get("description", ""),
            category=category,
        )

    def matches_tags(self, tags: list[str], match_all: bool = False) -> bool:
        """Check if resource matches the given tags."""
        if match_all:
            return all(tag in self.tags for tag in tags)
        return any(tag in self.tags for tag in tags)

    def matches_search(self, query: str) -> bool:
        """Check if resource matches a search query."""
        query_lower = query.lower()
        return (
            query_lower in self.name.lower()
            or query_lower in self.description.lower()
            or any(query_lower in tag.lower() for tag in self.tags)
        )


@dataclass
class ResourceRegistry:
    """Registry of all research resources loaded from YAML files."""

    resources: list[Resource] = field(default_factory=list)
    categories: dict[str, list[Resource]] = field(default_factory=dict)
    presets: dict[str, Preset] = field(default_factory=dict)
    _loaded: bool = False

    def __post_init__(self) -> None:
        """Auto-load resources on initialization."""
        if not self._loaded:
            self.load_all()

    def load_all(self, directory: Path | None = None) -> None:
        """Load all YAML resource files from the directory."""
        directory = directory or RESOURCES_DIR
        self.resources = []
        self.categories = {}
        self.presets = {}

        yaml_files = list(directory.glob("*.yaml")) + list(directory.glob("*.yml"))

        for yaml_file in yaml_files:
            if yaml_file.name.startswith("_"):  # Skip disabled files
                continue
            try:
                if yaml_file.name == "presets.yaml":
                    self._load_presets(yaml_file)
                else:
                    self._load_file(yaml_file)
            except Exception as e:
                logger.warning(f"Failed to load {yaml_file}: {e}")

        self._loaded = True
        logger.info(f"Loaded {len(self.resources)} resources, {len(self.presets)} presets")

    def _load_presets(self, path: Path) -> None:
        """Load presets from presets.yaml."""
        with open(path) as f:
            data = yaml.safe_load(f)

        if not data or "presets" not in data:
            return

        for name, preset_data in data["presets"].items():
            self.presets[name] = Preset.from_dict(name, preset_data)

    def _load_file(self, path: Path) -> None:
        """Load a single YAML file."""
        with open(path) as f:
            data = yaml.safe_load(f)

        if not data or "resources" not in data:
            return

        category = data.get("category", path.stem)

        for item in data["resources"]:
            resource = Resource.from_dict(item, category=category)
            self.resources.append(resource)

            if category not in self.categories:
                self.categories[category] = []
            self.categories[category].append(resource)

    def reload(self) -> None:
        """Reload all resources from disk."""
        self._loaded = False
        self.load_all()

    # === Query Methods ===

    def all(self) -> list[Resource]:
        """Get all resources."""
        return self.resources.copy()

    def by_category(self, category: str) -> list[Resource]:
        """Get resources by category (e.g., 'security', 'default')."""
        return self.categories.get(category, []).copy()

    def by_tags(
        self,
        tags: list[str],
        match_all: bool = False,
        exclude_tags: list[str] | None = None,
    ) -> list[Resource]:
        """
        Get resources matching tags.

        Args:
            tags: Tags to match
            match_all: If True, resource must have ALL tags. If False, ANY tag matches.
            exclude_tags: Tags to exclude from results
        """
        exclude_tags = exclude_tags or []
        results = []

        for resource in self.resources:
            if resource.matches_tags(tags, match_all=match_all):
                if not any(tag in resource.tags for tag in exclude_tags):
                    results.append(resource)

        return results

    def by_type(self, resource_type: str) -> list[Resource]:
        """Get resources by type (api, feed, scrape, archive, database)."""
        return [r for r in self.resources if r.type == resource_type]

    def free_only(self) -> list[Resource]:
        """Get resources that don't require authentication."""
        return [r for r in self.resources if not r.auth_required]

    def with_api(self) -> list[Resource]:
        """Get resources that have an API endpoint."""
        return [r for r in self.resources if r.api_url]

    def search(self, query: str) -> list[Resource]:
        """Search resources by name, description, or tags."""
        return [r for r in self.resources if r.matches_search(query)]

    # === Preset Methods ===

    def by_preset(self, preset_name: str) -> list[Resource]:
        """
        Get resources for a named preset.

        Returns the curated list of resources defined in presets.yaml.
        If include_defaults is True, also includes default category resources.
        """
        if preset_name not in self.presets:
            logger.warning(f"Preset '{preset_name}' not found")
            return self.by_category("default")

        preset = self.presets[preset_name]
        results = []

        # Add preset-specific resources by name
        resource_names = {r.name for r in self.resources}
        for name in preset.resources:
            matching = [r for r in self.resources if r.name == name]
            results.extend(matching)
            if not matching and name in resource_names:
                logger.debug(f"Resource '{name}' in preset but not found")

        # Add defaults if requested
        if preset.include_defaults:
            defaults = self.by_category("default")
            # Avoid duplicates
            existing_names = {r.name for r in results}
            for r in defaults:
                if r.name not in existing_names:
                    results.append(r)

        return results

    def list_presets(self) -> list[dict[str, Any]]:
        """Get list of all presets with their descriptions."""
        return [
            {
                "name": name,
                "description": preset.description,
                "use_when": preset.use_when,
                "resource_count": len(preset.resources),
                "brave_sites_count": len(preset.brave_sites),
                "api_resources": preset.api_resources,
                "include_defaults": preset.include_defaults,
            }
            for name, preset in self.presets.items()
        ]

    def get_preset(self, name: str) -> Preset | None:
        """Get a preset by name."""
        return self.presets.get(name)

    def suggest_preset(self, query: str) -> str:
        """
        Suggest the best preset for a given query.

        Uses keyword matching against preset use_when triggers.
        Returns preset name or 'general' if no match.
        """
        query_lower = query.lower()

        # Check each preset's use_when triggers
        for name, preset in self.presets.items():
            for trigger in preset.use_when:
                # Check if any trigger keywords are in the query
                trigger_words = trigger.lower().split()
                if any(word in query_lower for word in trigger_words if len(word) > 3):
                    return name

        return "general"

    # === Convenience Methods for Common Use Cases ===

    def red_team(self) -> list[Resource]:
        """Get offensive security resources."""
        return self.by_tags(["red_team"])

    def blue_team(self) -> list[Resource]:
        """Get defensive security resources."""
        return self.by_tags(["blue_team"])

    def vulnerability_intel(self) -> list[Resource]:
        """Get vulnerability and exploit resources."""
        return self.by_tags(["vulns", "exploits", "cve", "poc"])

    def threat_intel(self) -> list[Resource]:
        """Get threat intelligence resources."""
        return self.by_tags(["threat_intel", "iocs", "apt", "malware"])

    def osint(self) -> list[Resource]:
        """Get OSINT and reconnaissance resources."""
        return self.by_tags(["osint", "recon"])

    def detection(self) -> list[Resource]:
        """Get detection and monitoring resources."""
        return self.by_tags(["detection", "rules", "siem", "yara"])

    # === Utility Methods ===

    def get_all_tags(self) -> set[str]:
        """Get all unique tags across all resources."""
        tags: set[str] = set()
        for resource in self.resources:
            tags.update(resource.tags)
        return tags

    def get_categories(self) -> list[str]:
        """Get list of all categories."""
        return list(self.categories.keys())

    def stats(self) -> dict[str, Any]:
        """Get statistics about loaded resources."""
        return {
            "total_resources": len(self.resources),
            "categories": {cat: len(res) for cat, res in self.categories.items()},
            "presets": len(self.presets),
            "preset_names": list(self.presets.keys()),
            "unique_tags": len(self.get_all_tags()),
            "with_api": len(self.with_api()),
            "free": len(self.free_only()),
            "auth_required": len([r for r in self.resources if r.auth_required]),
        }

    def to_markdown_table(self, resources: list[Resource] | None = None) -> str:
        """Generate a markdown table of resources."""
        resources = resources or self.resources

        lines = [
            "| Name | Type | Tags | Auth | Description |",
            "|------|------|------|------|-------------|",
        ]

        for r in resources:
            tags = ", ".join(r.tags[:3])  # Limit to 3 tags
            if len(r.tags) > 3:
                tags += "..."
            auth = "Yes" if r.auth_required else "No"
            desc = r.description[:50] + "..." if len(r.description) > 50 else r.description
            lines.append(f"| [{r.name}]({r.url}) | {r.type} | {tags} | {auth} | {desc} |")

        return "\n".join(lines)


# Singleton instance for convenience
_registry: ResourceRegistry | None = None


def get_registry() -> ResourceRegistry:
    """Get the singleton registry instance."""
    global _registry
    if _registry is None:
        _registry = ResourceRegistry()
    return _registry


# CLI interface
if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Query the resource registry")
    parser.add_argument("--category", "-c", help="Filter by category")
    parser.add_argument("--tags", "-t", nargs="+", help="Filter by tags")
    parser.add_argument("--search", "-s", help="Search query")
    parser.add_argument("--type", help="Filter by resource type")
    parser.add_argument("--free", action="store_true", help="Only free resources")
    parser.add_argument("--stats", action="store_true", help="Show statistics")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--markdown", action="store_true", help="Output as Markdown table")

    args = parser.parse_args()

    registry = get_registry()

    if args.stats:
        stats = registry.stats()
        if args.json:
            print(json.dumps(stats, indent=2))
        else:
            print("Resource Registry Statistics:")
            print(f"  Total resources: {stats['total_resources']}")
            print(f"  Categories: {stats['categories']}")
            print(f"  Unique tags: {stats['unique_tags']}")
            print(f"  With API: {stats['with_api']}")
            print(f"  Free: {stats['free']}")
            print(f"  Auth required: {stats['auth_required']}")
    else:
        # Build filter chain
        results = registry.all()

        if args.category:
            results = [r for r in results if r.category == args.category]

        if args.tags:
            results = [r for r in results if r.matches_tags(args.tags)]

        if args.search:
            results = [r for r in results if r.matches_search(args.search)]

        if args.type:
            results = [r for r in results if r.type == args.type]

        if args.free:
            results = [r for r in results if not r.auth_required]

        # Output
        if args.json:
            output = [
                {
                    "name": r.name,
                    "url": r.url,
                    "api_url": r.api_url,
                    "type": r.type,
                    "tags": r.tags,
                    "category": r.category,
                    "auth_required": r.auth_required,
                    "description": r.description,
                }
                for r in results
            ]
            print(json.dumps(output, indent=2))
        elif args.markdown:
            print(registry.to_markdown_table(results))
        else:
            print(f"Found {len(results)} resources:\n")
            for r in results:
                print(f"  [{r.category}] {r.name}")
                print(f"    URL: {r.url}")
                print(f"    Tags: {', '.join(r.tags)}")
                print(f"    Type: {r.type} | Auth: {'Yes' if r.auth_required else 'No'}")
                print(f"    {r.description}")
                print()
