"""Dogpile: Comprehensive deep search aggregator.

A modular package for orchestrating searches across multiple providers:
- Brave Search (Web)
- Perplexity (Deep Research)
- GitHub (Repos & Issues)
- ArXiv (Papers)
- YouTube (Videos)
- Discord (Security Servers)
- Readarr (Books/Usenet)
- Wayback Machine (Archives)
"""
from dogpile.config import VERSION

__version__ = VERSION
__all__ = [
    "config",
    "utils",
    "brave",
    "perplexity",
    "arxiv_search",
    "github_search",
    "youtube_search",
    "wayback",
    "codex",
    "discord",
    "readarr",
    "synthesis",
]
