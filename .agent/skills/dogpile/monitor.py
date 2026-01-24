#!/usr/bin/env python3
"""
Textual Monitor for Dogpile.
Tails dogpile.log and updates a status dashboard.
"""
import asyncio
import os
from pathlib import Path
from textual.app import App, ComposeResult
from textual.containers import Container, Grid
from textual.widgets import Header, Footer, Static, Log
from textual.reactive import reactive

LOG_FILE = Path("dogpile.log")

class ProviderCard(Static):
    """A widget to display the status of a search provider."""
    
    status = reactive("PENDING")
    
    CLASSES = "provider-card"

    def __init__(self, name: str, icon: str, **kwargs):
        super().__init__(**kwargs)
        self.provider_name = name
        self.icon = icon

    def compose(self) -> ComposeResult:
        yield Static(f"{self.icon} {self.provider_name}", classes="title")
        yield Static(self.status, classes="status", id=f"status-{self.provider_name}")

    def watch_status(self, status: str) -> None:
        """Update style based on status."""
        self.remove_class("running", "done", "error", "pending")
        if status == "RUNNING":
            self.add_class("running")
            self.update(f"{self.icon} {self.provider_name}\n[Running...]")
        elif status == "DONE":
            self.add_class("done")
            self.update(f"{self.icon} {self.provider_name}\n[Done]")
        elif status == "PENDING":
            self.add_class("pending")
            self.update(f"{self.icon} {self.provider_name}\n[Pending]")
        else:
             self.add_class("error")

class DogpileMonitor(App):
    """Textual App to monitor Dogpile search progress."""

    CSS = """
    Screen {
        layout: grid;
        grid-size: 2;
        grid-rows: 60% 40%;
    }

    .provider-grid {
        layout: grid;
        grid-size: 3;
        grid-gutter: 1;
        padding: 1;
        border: solid green;
    }

    .provider-card {
        height: 100%;
        border: solid gray;
        content-align: center middle;
        text-align: center;
    }

    .provider-card .title {
        text-style: bold;
    }

    .running {
        background: yellow;
        color: black;
        border: solid orange;
    }
    
    .done {
        background: green;
        color: white;
        border: solid lightgreen;
    }

    .pending {
        color: gray;
    }

    Log {
        border: solid blue;
        row-span: 1;
        column-span: 2;
    }
    """

    BINDINGS = [("q", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        yield Header()
        
        with Container(classes="provider-grid"):
            yield ProviderCard("Brave", "🌐", id="card-brave")
            yield ProviderCard("Perplexity", "🧠", id="card-perplexity")
            yield ProviderCard("GitHub", "🐙", id="card-github")
            yield ProviderCard("ArXiv", "📄", id="card-arxiv")
            yield ProviderCard("YouTube", "📺", id="card-youtube")
            yield ProviderCard("Wayback", "🏛️", id="card-wayback")

        yield Log(id="log_view", highlight=True)
        yield Footer()

    def on_mount(self) -> None:
        """Start the log tailing worker."""
        self.run_worker(self.tail_log())

    async def tail_log(self) -> None:
        """Tail the dogpile.log file."""
        log_view = self.query_one(Log)
        
        # Ensure log file exists
        if not LOG_FILE.exists():
            log_view.write(f"Waiting for {LOG_FILE} to be created...")
            while not LOG_FILE.exists():
                await asyncio.sleep(1)

        log_view.write(f"Tailing {LOG_FILE}...")
        
        with open(LOG_FILE, "r") as f:
            # Go to end? Or read from start? 
            # If we just started a search, we want to see it.
            # Let's read the last 100 lines then tail.
            # Simple approach: Read all, then tail.
            lines = f.readlines()
            for line in lines[-50:]:
                 self.process_line(line)
            
            f.seek(0, os.SEEK_END)
            
            while True:
                line = f.readline()
                if not line:
                    await asyncio.sleep(0.1)
                    continue
                
                self.process_line(line)

    def process_line(self, line: str) -> None:
        """Process a log line and update UI."""
        log_view = self.query_one(Log)
        log_view.write(line.strip())
        
        if "[DOGPILE-STATUS]" in line:
            msg = line.split("[DOGPILE-STATUS]")[1].strip()
            self.update_provider_status(msg)

    def update_provider_status(self, msg: str) -> None:
        """Parse status message and update cards."""
        # msg format: "Starting Brave Search..." or "Brave Search finished."
        
        provider = None
        status = None
        
        if "Brave" in msg:
            provider = "brave"
        elif "Perplexity" in msg:
            provider = "perplexity"
        elif "GitHub" in msg:
            provider = "github"
        elif "ArXiv" in msg:
            provider = "arxiv"
        elif "YouTube" in msg:
            provider = "youtube"
        elif "Wayback" in msg:
            provider = "wayback"
            
        if not provider:
            return

        if "Starting" in msg:
            status = "RUNNING"
        elif "finished" in msg:
            status = "DONE"
        
        if status:
            try:
                card = self.query_one(f"#card-{provider}", ProviderCard)
                card.status = status
            except Exception:
                pass


if __name__ == "__main__":
    app = DogpileMonitor()
    app.run()
