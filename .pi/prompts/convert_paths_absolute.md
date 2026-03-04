---
allowed-tools: Read,Bash,Edit,Write
description: Converts relative paths in .claude/settings.json command scripts to absolute paths
---

# convert_paths_absolute

This command converts all relative paths in .claude/settings.json command scripts to absolute paths using the current working directory. It helps ensure that command scripts work correctly regardless of where they are executed from.

## Instructions
- Get the current working directory using pwd
- Read the .claude/settings.json file
- Parse the JSON content to find all command scripts
- Identify relative paths in the command scripts (paths that don't start with / or ~)
- Convert each relative path to an absolute path by prepending the current working directory
- Update the settings.json file with the converted absolute paths
- Show the user what changes were made
- Handle cases where paths might be arguments to commands (e.g., python relative/path/script.py)
- Preserve the existing JSON formatting and structure
- Create a backup of the original settings.json before making changes