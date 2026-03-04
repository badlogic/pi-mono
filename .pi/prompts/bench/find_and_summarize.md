---
description: Finds and summarizes specific files in the codebase and saves the summary to app_docs directory
argument-hint: [run-name]
---

# Purpose

Find and summarize specific files in the codebase.

## Variables

RUN_NAME: $1
FILE_EXTENSIONS: $2 or '*.vue, *.ts'
SEARCH_DIRECTORY: $3 or './apps' (current directory)

## Instructions

- Recursively find all files in the `SEARCH_DIRECTORY` with the given `FILE_EXTENSIONS`, summarize them in the exact `REPORT_FORMAT`.
- Do not use any subagents to do this. Run your own code to accomplish this task.
- Do not read any other files in the codebase other than the ones specified in the `FILE_EXTENSIONS` and `SEARCH_DIRECTORY`.


## Workflow

1. Find all files in the `SEARCH_DIRECTORY` with the given `FILE_EXTENSIONS`
2. Read as much of each file as you need to to understand it's purpose and functionality. 
   - IMPORTANT: Read top to bottom in increments of 50 lines, then 100, then 200, etc. Stop reading when you have a good understanding of the file's purpose and functionality or you have read the entire file.
3. Continue your search until you have summarized every file in the `SEARCH_DIRECTORY` that matches the `FILE_EXTENSIONS`.
4. Return the summary in the exact `REPORT_FORMAT`.

## Report

- IMPORTANT: Create two sentence summaries for each file.
    - In the first sentence, describe the file's purpose and functionality.
    - In the second sentence, describe where the file is used in the codebase.
- Create the output file at `app_docs/find_and_summarize_<RUN_NAME>.yaml` (output dir already exists)

### Report Format

```yaml
summary:
  - file_path: <file-path>
    summary: <summary>
  - file_path: <file-path>
    summary: <summary>
  # ... continue for all files
```
