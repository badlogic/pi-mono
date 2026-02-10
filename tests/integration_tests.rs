use anyhow::Result;
use std::fs;
use tempfile::TempDir;
use todo_scan::{format_results_colored, format_results_json, ScanConfig, TodoScanner};

#[tokio::test]
async fn test_scan_single_file_with_todo() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("test.py");

    fs::write(
        &file_path,
        "def main():\n    # TODO: Implement main logic\n    pass\n\n# FIXME: This is broken\nx = 1\n",
    )?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_file(&file_path).await?;

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].keyword, "TODO");
    assert_eq!(entries[0].line_number, 2);
    assert_eq!(entries[1].keyword, "FIXME");
    assert_eq!(entries[1].line_number, 5);
    // Verify text content
    assert!(entries[0].text.contains("TODO"));
    assert!(entries[1].text.contains("FIXME"));

    Ok(())
}

#[tokio::test]
async fn test_scan_directory_multiple_files() -> Result<()> {
    let temp_dir = TempDir::new()?;

    // Create multiple files with TODOs
    fs::write(
        temp_dir.path().join("file1.py"),
        "# TODO: First task\nx = 1\n",
    )?;
    fs::write(
        temp_dir.path().join("file2.rs"),
        "// FIXME: Fix this\nfn main() {}\n",
    )?;
    fs::create_dir(temp_dir.path().join("subdir"))?;
    fs::write(
        temp_dir.path().join("subdir/file3.js"),
        "// TODO: Deep todo\nconst x = 1;\n",
    )?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    assert_eq!(entries.len(), 3);

    Ok(())
}

#[tokio::test]
async fn test_scan_no_matches() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("clean.py");

    fs::write(&file_path, "def clean():\n    pass\n")?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_file(&file_path).await?;

    assert!(entries.is_empty());

    Ok(())
}

#[tokio::test]
async fn test_case_insensitive_keywords() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("test.py");

    fs::write(
        &file_path,
        "# todo: lowercase\n# Todo: Title case\n# ToDo: MiXeD\n# FIXME: all caps\n",
    )?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_file(&file_path).await?;

    assert_eq!(entries.len(), 4);

    Ok(())
}

#[tokio::test]
async fn test_custom_keywords() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("test.py");

    fs::write(
        &file_path,
        "# HACK: workaround\n# NOTE: documentation\n# BUG: known issue\n",
    )?;

    let config = ScanConfig {
        keywords: vec!["HACK".to_string(), "NOTE".to_string(), "BUG".to_string()],
        ..Default::default()
    };

    let scanner = TodoScanner::new(config)?;
    let entries = scanner.scan_file(&file_path).await?;

    assert_eq!(entries.len(), 3);
    assert!(entries.iter().any(|e| e.keyword == "HACK"));
    assert!(entries.iter().any(|e| e.keyword == "NOTE"));
    assert!(entries.iter().any(|e| e.keyword == "BUG"));

    Ok(())
}

#[tokio::test]
async fn test_exclude_patterns() -> Result<()> {
    let temp_dir = TempDir::new()?;

    fs::write(temp_dir.path().join("include.py"), "# TODO: keep me\n")?;
    fs::write(temp_dir.path().join("exclude.py"), "# TODO: exclude me\n")?;

    let config = ScanConfig {
        keywords: vec!["TODO".to_string()],
        exclude_patterns: vec!["exclude".to_string()],
        ..Default::default()
    };

    let scanner = TodoScanner::new(config)?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    assert_eq!(entries.len(), 1);
    assert!(entries[0].text.contains("keep me"));

    Ok(())
}

#[tokio::test]
async fn test_include_patterns() -> Result<()> {
    let temp_dir = TempDir::new()?;

    fs::write(temp_dir.path().join("include.py"), "# TODO: keep me\n")?;
    fs::write(temp_dir.path().join("exclude.js"), "// TODO: exclude me\n")?;

    let config = ScanConfig {
        keywords: vec!["TODO".to_string()],
        include_patterns: vec![".py".to_string()],
        ..Default::default()
    };

    let scanner = TodoScanner::new(config)?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    assert_eq!(entries.len(), 1);
    assert!(entries[0].text.contains("keep me"));

    Ok(())
}

#[tokio::test]
async fn test_large_file_skipped() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("large.py");

    // Create a file larger than max_file_size
    let large_content = "x\n".repeat(100);
    fs::write(&file_path, large_content)?;

    let config = ScanConfig {
        max_file_size: 1, // 1 byte max
        ..Default::default()
    };

    let scanner = TodoScanner::new(config)?;
    let entries = scanner.scan_file(&file_path).await?;

    assert!(entries.is_empty());

    Ok(())
}

#[tokio::test]
async fn test_result_formatting_colored() {
    let entries = vec![
        todo_scan::TodoEntry::new("/test/file.py", 10, "TODO", "Implement feature"),
        todo_scan::TodoEntry::new("/test/file.py", 25, "FIXME", "Fix this bug"),
    ];

    let output = format_results_colored(&entries, false);

    assert!(!output.is_empty());
    assert!(output.contains("file.py"));
    assert!(output.contains("TODO"));
    assert!(output.contains("FIXME"));
}

#[tokio::test]
async fn test_result_formatting_json() -> Result<()> {
    let entries = vec![
        todo_scan::TodoEntry::new("/test/file.py", 10, "TODO", "Implement feature"),
    ];

    let json_str = format_results_json(&entries)?;
    let parsed: serde_json::Value = serde_json::from_str(&json_str)?;

    assert!(parsed.is_array());
    assert_eq!(parsed.as_array().unwrap().len(), 1);

    Ok(())
}

#[tokio::test]
async fn test_empty_results_colored() {
    let entries: Vec<todo_scan::TodoEntry> = vec![];

    let output = format_results_colored(&entries, false);

    assert!(output.contains("No TODO"));
}

#[tokio::test]
async fn test_ignored_directories() -> Result<()> {
    let temp_dir = TempDir::new()?;

    fs::write(temp_dir.path().join("main.py"), "# TODO: main\n")?;

    // Create .git directory
    fs::create_dir(temp_dir.path().join(".git"))?;
    fs::write(temp_dir.path().join(".git/config"), "# TODO: git\n")?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    assert_eq!(entries.len(), 1);
    assert!(entries[0].file_path.ends_with("main.py"));

    Ok(())
}

#[tokio::test]
async fn test_binary_file_ignored() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("test.bin");

    // Write some binary content
    fs::write(&file_path, b"\x00\x01\x02\x03TODO: binary\n")?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    // Binary file should be skipped (has .bin extension that's not in supported list)
    assert!(entries.is_empty());

    Ok(())
}

#[tokio::test]
async fn test_nested_directories() -> Result<()> {
    let temp_dir = TempDir::new()?;

    // Create nested structure
    fs::create_dir_all(temp_dir.path().join("a/b/c"))?;
    fs::write(temp_dir.path().join("a/file1.py"), "# TODO: level 1\n")?;
    fs::write(temp_dir.path().join("a/b/file2.py"), "# TODO: level 2\n")?;
    fs::write(temp_dir.path().join("a/b/c/file3.py"), "# TODO: level 3\n")?;

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    assert_eq!(entries.len(), 3);

    Ok(())
}

#[tokio::test]
async fn test_context_lines() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_path = temp_dir.path().join("test.py");

    fs::write(
        &file_path,
        "line 1\nline 2\n# TODO: third line\nline 4\nline 5\n",
    )?;

    let config = ScanConfig {
        context_lines: 2,
        ..Default::default()
    };

    let scanner = TodoScanner::new(config)?;
    let entries = scanner.scan_file(&file_path).await?;

    assert_eq!(entries.len(), 1);
    assert!(entries[0].context.is_some());

    let json_str = format_results_json(&entries)?;
    assert!(json_str.contains("context"));

    Ok(())
}

#[tokio::test]
async fn test_scan_various_extensions() -> Result<()> {
    let temp_dir = TempDir::new()?;

    // Test different file extensions that are supported
    let test_files = [
        ("rust.rs", "// TODO: rust"),
        ("go.go", "// TODO: go"),
        ("java.java", "// TODO: java"),
        ("javascript.js", "// TODO: js"),
        ("typescript.ts", "// TODO: ts"),
        ("shell.sh", "# TODO: shell"),
        ("markdown.md", "TODO: markdown"),
        ("text.txt", "TODO: text"),
    ];

    for (filename, content) in test_files {
        fs::write(temp_dir.path().join(filename), format!("{}\n", content))?;
    }

    let scanner = TodoScanner::default_scanner()?;
    let entries = scanner.scan_directory(temp_dir.path()).await?;

    assert_eq!(entries.len(), test_files.len());

    Ok(())
}