use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use colored::Colorize;
use std::path::PathBuf;

use todo_scan::{format_results_colored, format_results_json, ScanConfig, TodoScanner};

#[derive(Parser, Debug)]
#[command(
    name = "todo-scan",
    about = "A high-performance CLI utility to scan text files for TODO/FIXME lines",
    version = "1.0.0",
    author = "Pi Mono Contributors"
)]
struct Cli {
    /// Paths to scan (files or directories)
    #[arg(value_name = "PATH", default_value = ".")]
    paths: Vec<PathBuf>,

    /// Output format
    #[arg(short, long, value_enum, default_value = "text")]
    format: OutputFormat,

    /// Additional keywords to search for (comma-separated)
    #[arg(short, long, value_name = "KEYWORDS")]
    keywords: Option<String>,

    /// Include only files matching these patterns (comma-separated)
    #[arg(long, value_name = "PATTERNS")]
    include: Option<String>,

    /// Exclude files matching these patterns (comma-separated)
    #[arg(long, value_name = "PATTERNS")]
    exclude: Option<String>,

    /// Number of context lines to show
    #[arg(short, long, default_value = "0")]
    context: usize,

    /// Don't respect .gitignore files
    #[arg(long)]
    no_gitignore: bool,

    /// Maximum file size in MB to scan
    #[arg(short, long, default_value = "10")]
    max_size: usize,

    /// Exit with error code if TODOs found
    #[arg(long)]
    fail_on_find: bool,

    /// Suppress informational output
    #[arg(short, long)]
    quiet: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialize colored output
    colored::control::set_override(true);

    let mut config = ScanConfig::default();

    // Parse custom keywords
    if let Some(keywords_str) = cli.keywords {
        let keywords: Vec<String> = keywords_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !keywords.is_empty() {
            config.keywords = keywords;
        }
    }

    // Parse include patterns
    if let Some(patterns) = cli.include {
        config.include_patterns = patterns
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    // Parse exclude patterns
    if let Some(patterns) = cli.exclude {
        config.exclude_patterns = patterns
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    config.context_lines = cli.context;
    config.respect_gitignore = !cli.no_gitignore;
    config.max_file_size = cli.max_size * 1024 * 1024;

    if !cli.quiet {
        eprintln!("{}", "todo-scan v1.0.0".bold());
        eprintln!("{}", format!("Keywords: {}", config.keywords.join(", ")).dimmed());
        if !cli.paths.is_empty() {
            eprintln!(
                "{}",
                format!(
                    "Scanning: {}",
                    cli.paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
                )
                .dimmed()
            );
        }
        eprintln!();
    }

    let scanner = TodoScanner::new(config).context("Failed to initialize scanner")?;

    let mut all_entries = Vec::new();

    for path in &cli.paths {
        if path.is_file() {
            match scanner.scan_file(path).await {
                Ok(entries) => all_entries.extend(entries),
                Err(e) => {
                    if !cli.quiet {
                        eprintln!(
                            "{} {}",
                            "Warning:".yellow().bold(),
                            format!("Failed to scan {}: {}", path.display(), e)
                        );
                    }
                }
            }
        } else if path.is_dir() {
            match scanner.scan_directory(path).await {
                Ok(entries) => all_entries.extend(entries),
                Err(e) => {
                    if !cli.quiet {
                        eprintln!(
                            "{} {}",
                            "Warning:".yellow().bold(),
                            format!("Failed to scan {}: {}", path.display(), e)
                        );
                    }
                }
            }
        } else {
            if !cli.quiet {
                eprintln!(
                    "{} {}",
                    "Warning:".yellow().bold(),
                    format!("Path not found: {}", path.display())
                );
            }
        }
    }

    // Output results
    match cli.format {
        OutputFormat::Text => {
            let output = format_results_colored(&all_entries, cli.context > 0);
            println!("{}", output);
        }
        OutputFormat::Json => {
            let output = format_results_json(&all_entries).context("Failed to format JSON")?;
            println!("{}", output);
        }
    }

    // Exit with appropriate code
    if cli.fail_on_find && !all_entries.is_empty() {
        std::process::exit(1);
    }

    Ok(())
}
