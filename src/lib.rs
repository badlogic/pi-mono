use anyhow::{Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader};
use walkdir::WalkDir;

/// A scanned TODO/FIXME entry
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TodoEntry {
    pub file_path: PathBuf,
    pub line_number: usize,
    pub keyword: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

impl TodoEntry {
    pub fn new(
        file_path: impl AsRef<Path>,
        line_number: usize,
        keyword: impl Into<String>,
        text: impl Into<String>,
    ) -> Self {
        Self {
            file_path: file_path.as_ref().to_path_buf(),
            line_number,
            keyword: keyword.into(),
            text: text.into(),
            context: None,
        }
    }

    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }
}

/// Configuration for scanning
#[derive(Debug, Clone)]
pub struct ScanConfig {
    pub keywords: Vec<String>,
    pub include_patterns: Vec<String>,
    pub exclude_patterns: Vec<String>,
    pub context_lines: usize,
    pub respect_gitignore: bool,
    pub max_file_size: usize,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            keywords: vec!["TODO".to_string(), "FIXME".to_string()],
            include_patterns: vec![],
            exclude_patterns: vec![],
            context_lines: 0,
            respect_gitignore: true,
            max_file_size: 10 * 1024 * 1024, // 10MB
        }
    }
}

/// Scanner for finding TODO/FIXME entries in files
pub struct TodoScanner {
    config: ScanConfig,
    keyword_regex: Regex,
}

impl TodoScanner {
    /// Create a new scanner with the given configuration
    pub fn new(config: ScanConfig) -> Result<Self> {
        let keyword_pattern = config
            .keywords
            .iter()
            .map(|k| regex::escape(k))
            .collect::<Vec<_>>()
            .join("|");

        let pattern = format!(r"(?i)\b({})\b", keyword_pattern);
        let keyword_regex = Regex::new(&pattern)
            .with_context(|| "Failed to compile keyword regex")?;

        Ok(Self {
            config,
            keyword_regex,
        })
    }

    /// Create a scanner with default configuration
    pub fn default_scanner() -> Result<Self> {
        Self::new(ScanConfig::default())
    }

    /// Scan a directory recursively
    pub async fn scan_directory(&self, path: impl AsRef<Path>) -> Result<Vec<TodoEntry>> {
        let path = path.as_ref();
        let mut entries = Vec::new();

        let walker: Box<dyn Iterator<Item = Result<walkdir::DirEntry, walkdir::Error>>> = if self.config.respect_gitignore {
            Box::new(
                WalkDir::new(path)
                    .follow_links(false)
                    .into_iter()
                    .filter_entry(|e| !self.is_ignored(e)),
            )
        } else {
            Box::new(
                WalkDir::new(path)
                    .follow_links(false)
                    .into_iter(),
            )
        };

        for entry in walker {
            let entry = entry.with_context(|| "Failed to read directory entry")?;

            if !entry.file_type().is_file() {
                continue;
            }

            let file_path = entry.path();

            if !self.should_scan_file(file_path) {
                continue;
            }

            match self.scan_file(file_path).await {
                Ok(file_entries) => entries.extend(file_entries),
                Err(e) => {
                    eprintln!("Warning: Failed to scan {}: {}", file_path.display(), e);
                }
            }
        }

        entries.sort_by(|a, b| {
            a.file_path
                .cmp(&b.file_path)
                .then(a.line_number.cmp(&b.line_number))
        });

        Ok(entries)
    }

    /// Scan a single file
    pub async fn scan_file(&self, path: impl AsRef<Path>) -> Result<Vec<TodoEntry>> {
        let path = path.as_ref();
        let metadata = tokio::fs::metadata(path)
            .await
            .with_context(|| format!("Failed to read metadata for {}", path.display()))?;

        if !metadata.is_file() {
            return Ok(Vec::new());
        }

        let file_size = metadata.len() as usize;
        if file_size > self.config.max_file_size {
            return Ok(Vec::new());
        }

        let file = File::open(path)
            .await
            .with_context(|| format!("Failed to open {}", path.display()))?;

        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        let mut line_buffer: Vec<String> = Vec::with_capacity(self.config.context_lines * 2 + 1);
        let mut entries = Vec::new();
        let mut line_number: usize = 0;

        while let Some(line) = lines
            .next_line()
            .await
            .with_context(|| format!("Failed to read line from {}", path.display()))?
        {
            line_number += 1;

            if line.trim().is_empty() {
                continue;
            }

            if let Some(captures) = self.keyword_regex.captures(&line) {
                let keyword = captures
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();

                let text = line.trim().to_string();

                let mut entry = TodoEntry::new(path, line_number, keyword, text);

                if self.config.context_lines > 0 {
                    let context = self.build_context(&line_buffer, &line);
                    entry = entry.with_context(context);
                }

                entries.push(entry);
            }

            if self.config.context_lines > 0 {
                line_buffer.push(line.clone());
                if line_buffer.len() > self.config.context_lines * 2 + 1 {
                    line_buffer.remove(0);
                }
            }
        }

        Ok(entries)
    }

    fn build_context(&self, _buffer: &[String], current_line: &str) -> String {
        // For now, just return the current line as context
        // Full context implementation would join multiple lines
        current_line.to_string()
    }

    fn is_ignored(&self, entry: &walkdir::DirEntry) -> bool {
        let path = entry.path();

        if path
            .file_name()
            .map(|n| n == ".git")
            .unwrap_or(false)
        {
            return true;
        }

        if self.config.respect_gitignore {
            if let Some(parent) = path.parent() {
                if parent.join(".gitignore").exists() {
                    // Simple heuristic: check if path matches common ignore patterns
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with('.') || name.contains("node_modules") {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }

    fn should_scan_file(&self, path: &Path) -> bool {
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        // Supported text extensions
        let supported_exts = [
            "py", "js", "ts", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs",
            "rb", "php", "swift", "kt", "scala", "sh", "bash", "zsh", "fish",
            "md", "txt", "rst", "toml", "yaml", "yml", "json", "xml", "html",
            "css", "scss", "less", "sql", "r", "matlab", "lua",
        ];

        if !supported_exts.contains(&extension) {
            // Check filename patterns
            if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                if name.starts_with("Makefile")
                    || name == "Dockerfile"
                    || name.starts_with("Jenkinsfile")
                {
                    return true;
                }
            }
            return false;
        }

        // Check exclude patterns
        for pattern in &self.config.exclude_patterns {
            if let Ok(regex) = Regex::new(&format!(".*{}.*", regex::escape(pattern))) {
                if regex.is_match(&path.to_string_lossy()) {
                    return false;
                }
            }
        }

        // Check include patterns
        if !self.config.include_patterns.is_empty() {
            let path_str = path.to_string_lossy();
            for pattern in &self.config.include_patterns {
                if let Ok(regex) = Regex::new(&format!(".*{}.*", regex::escape(pattern))) {
                    if regex.is_match(&path_str) {
                        return true;
                    }
                }
            }
            return false;
        }

        true
    }
}

/// Format results as colored text output
pub fn format_results_colored(entries: &[TodoEntry], show_context: bool) -> String {
    use colored::*;

    let mut output = String::new();

    if entries.is_empty() {
        output.push_str(&"No TODO/FIXME entries found.".green().to_string());
        output.push('\n');
        return output;
    }

    output.push_str(&format!("{}\n", "TODO/FIXME Scan Results".bold().underline()));
    output.push('\n');

    let current_file = std::cell::Cell::new(None::<&Path>);

    for entry in entries {
        let file_path = entry.file_path.as_path();

        if current_file.get() != Some(file_path) {
            output.push('\n');
            output.push_str(&format!("{}", file_path.display().to_string().cyan().bold()));
            output.push('\n');
            output.push_str(&"─".repeat(file_path.to_string_lossy().len()));
            output.push('\n');
            current_file.set(Some(file_path));
        }

        let line_num = format!("{:>4}:", entry.line_number).dimmed();

        let keyword_colored = match entry.keyword.to_uppercase().as_str() {
            "TODO" => entry.keyword.yellow().bold(),
            "FIXME" => entry.keyword.red().bold(),
            _ => entry.keyword.normal(),
        };

        // Highlight the keyword in the text
        let text_colored = entry.text.replacen(
            &entry.keyword,
            &keyword_colored.to_string(),
            1,
        );

        output.push_str(&format!("{} {}\n", line_num, text_colored));

        if show_context && entry.context.is_some() {
            output.push_str(&format!("{}\n", "    ...".dimmed()));
        }
    }

    output.push('\n');
    output.push_str(&format!(
        "{}: {} {} found\n",
        "Summary".bold(),
        entries.len().to_string().yellow().bold(),
        if entries.len() == 1 { "entry" } else { "entries" }
    ));

    output
}

/// Format results as JSON
pub fn format_results_json(entries: &[TodoEntry]) -> Result<String> {
    serde_json::to_string_pretty(entries).context("Failed to serialize results to JSON")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_todo_entry_creation() {
        let entry = TodoEntry::new("/test/file.rs", 42, "TODO", "Implement feature");
        assert_eq!(entry.file_path, PathBuf::from("/test/file.rs"));
        assert_eq!(entry.line_number, 42);
        assert_eq!(entry.keyword, "TODO");
        assert_eq!(entry.text, "Implement feature");
    }

    #[test]
    fn test_scan_config_default() {
        let config = ScanConfig::default();
        assert_eq!(config.keywords, vec!["TODO", "FIXME"]);
        assert!(config.include_patterns.is_empty());
        assert!(config.exclude_patterns.is_empty());
        assert_eq!(config.max_file_size, 10 * 1024 * 1024);
    }
}