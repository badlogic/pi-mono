"""Configuration management for Mini-Claw."""

import json
import os
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field


class Config(BaseModel):
    """Mini-Claw configuration."""
    
    provider: str = Field(default="anthropic", description="LLM provider: anthropic or openai")
    api_key: Optional[str] = Field(default=None, description="API key (can also use env vars)")
    model: str = Field(default="claude-sonnet-4-5-20250929", description="Model to use")
    workspace: Optional[str] = Field(default=None, description="Workspace directory")
    
    class Config:
        extra = "ignore"


class ConfigManager:
    """Manages configuration loading and saving."""
    
    def __init__(self, config_path: Optional[str] = None):
        if config_path:
            self.config_path = Path(config_path).expanduser()
        else:
            # Default: ~/.mini-claw/config.json
            self.config_path = Path.home() / ".mini-claw" / "config.json"
    
    def load(self) -> Config:
        """Load configuration from file or environment."""
        # Try to load from file first
        if self.config_path.exists():
            with open(self.config_path, "r") as f:
                data = json.load(f)
            config = Config(**data)
        else:
            # Fall back to environment variables
            config = Config()
        
        # Environment variables override file config
        if env_key := os.environ.get("MINI_CLAW_API_KEY"):
            config.api_key = env_key
        if env_provider := os.environ.get("MINI_CLAW_PROVIDER"):
            config.provider = env_provider
        if env_model := os.environ.get("MINI_CLAW_MODEL"):
            config.model = env_model
        if env_workspace := os.environ.get("MINI_CLAW_WORKSPACE"):
            config.workspace = env_workspace
        
        # Provider-specific env vars
        if config.provider == "anthropic" and not config.api_key:
            config.api_key = os.environ.get("ANTHROPIC_API_KEY")
        elif config.provider == "openai" and not config.api_key:
            config.api_key = os.environ.get("OPENAI_API_KEY")
        
        return config
    
    def save(self, config: Config) -> None:
        """Save configuration to file."""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w") as f:
            json.dump(config.model_dump(), f, indent=2)
    
    def exists(self) -> bool:
        """Check if config file exists."""
        return self.config_path.exists()
