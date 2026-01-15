export const bashCompletionScript = `set -o pipefail
shopt -s progcomp
completion_file=""
for candidate in "\${BASH_COMPLETION_COMPAT_DIR:-}/bash_completion" "/usr/local/etc/bash_completion" "/opt/homebrew/etc/bash_completion" "/usr/share/bash-completion/bash_completion" "/usr/local/share/bash-completion/bash_completion" "/opt/homebrew/share/bash-completion/bash_completion" "/usr/local/etc/profile.d/bash_completion.sh" "/opt/homebrew/etc/profile.d/bash_completion.sh" "/etc/bash_completion"; do
  if [[ -n "$candidate" && -r "$candidate" ]]; then
    completion_file="$candidate"
    break
  fi
done
if [[ -n "$completion_file" ]]; then
  source "$completion_file"
fi

load_command_completion() {
  local cmd="$1"
  local -a candidates
  candidates=(
    "/etc/bash_completion.d/$cmd"
    "/usr/local/etc/bash_completion.d/$cmd"
    "/opt/homebrew/etc/bash_completion.d/$cmd"
    "/usr/share/bash-completion/completions/$cmd"
    "/usr/local/share/bash-completion/completions/$cmd"
    "/opt/homebrew/share/bash-completion/completions/$cmd"
  )

  if [[ "$cmd" = "git" ]]; then
    local exec_path=""
    if command -v git >/dev/null 2>&1; then
      exec_path=$(git --exec-path 2>/dev/null)
    fi
    if [[ -n "$exec_path" ]]; then
      candidates+=("\${exec_path%/git-core}/../share/git-core/git-completion.bash")
      candidates+=("\${exec_path%/libexec/git-core}/share/git-core/git-completion.bash")
    fi
    candidates+=(
      "/usr/share/git-core/git-completion.bash"
      "/usr/local/share/git-core/git-completion.bash"
      "/opt/homebrew/share/git-core/git-completion.bash"
      "/Applications/Xcode.app/Contents/Developer/usr/share/git-core/git-completion.bash"
    )
  fi

  local candidate
  for candidate in "\${candidates[@]}"; do
    if [[ -n "$candidate" && -r "$candidate" ]]; then
      source "$candidate"
      return 0
    fi
  done

  return 1
}

line="$PI_BASH_COMPLETION_LINE"
point="$PI_BASH_COMPLETION_POINT"
if [[ -z "$line" ]]; then exit 0; fi
COMP_LINE="$line"
COMP_POINT=$point
read -ra COMP_WORDS <<< "$line"
word_index=0
in_word=0
for ((i=0; i<point; i++)); do
  ch="\${line:i:1}"
  if [[ "$ch" =~ [[:space:]] ]]; then
    if (( in_word )); then
      in_word=0
      word_index=$((word_index+1))
    fi
  else
    in_word=1
  fi
done
COMP_CWORD=$word_index
if (( COMP_CWORD >= \${#COMP_WORDS[@]} )); then
  COMP_WORDS+=("")
fi
cmd="\${COMP_WORDS[0]}"
if [[ -z "$cmd" ]]; then exit 0; fi
if type _completion_loader >/dev/null 2>&1; then
  _completion_loader "$cmd" >/dev/null 2>&1
fi
completion=$(complete -p "$cmd" 2>/dev/null | head -n 1)
if [[ -z "$completion" ]]; then
  load_command_completion "$cmd"
  completion=$(complete -p "$cmd" 2>/dev/null | head -n 1)
fi
if [[ -z "$completion" ]]; then exit 0; fi
cur="\${COMP_WORDS[COMP_CWORD]}"
comp_cmd=\${completion#complete }
comp_cmd=\${comp_cmd% $cmd}
comp_cmd=\${comp_cmd% --}
eval "compgen \${comp_cmd} -- \\"$cur\\""
`;
