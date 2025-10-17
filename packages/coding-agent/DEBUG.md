# Debug Mode Guide

## Enabling Debug Output

Debug logs are written to files in `/tmp/` to avoid interfering with TUI rendering.

There are three ways to enable debug output:

1. **CLI flag**: `--debug` or `-d`
   ```bash
   coding-agent --debug --script "Hello"
   ```
   This will print log file locations:
   ```
   [TUI] Debug logging to: /tmp/tui-debug-1234567890.log
   [RENDERER] Debug logging to: /tmp/agent-debug-1234567890.log
   ```

2. **Environment variables**:
   ```bash
   TUI_DEBUG=1 AGENT_DEBUG=1 coding-agent
   ```

3. **Individual components**:
   ```bash
   TUI_DEBUG=1 coding-agent        # Only TUI debug
   AGENT_DEBUG=1 coding-agent      # Only agent/renderer debug
   ```

## Viewing Debug Logs

Debug logs are written to `/tmp/` with timestamps:
- `/tmp/tui-debug-<timestamp>.log` - TUI rendering events
- `/tmp/agent-debug-<timestamp>.log` - Agent/renderer events

To tail the logs while the agent runs:
```bash
# In one terminal
coding-agent --debug --script "Hello"

# In another terminal (use the path printed above)
tail -f /tmp/tui-debug-*.log
tail -f /tmp/agent-debug-*.log
```

## Scripted Messages for Testing

Use `--script` to replay messages automatically in interactive mode:

```bash
# Single scripted message
coding-agent --debug --script "What files are in this directory?"

# Multiple scripted messages
coding-agent --debug --script "Hello" --script "List the files" --script "Read package.json"
```

The agent will:
1. Type the message into the editor
2. Submit it
3. Wait for the agent to complete its response
4. Move to the next message
5. Exit after all messages are processed

## Debug Output Reference

### TUI Debug Messages

**`[TUI DEBUG]`** - Low-level terminal UI rendering events

- **`requestRender() called but TUI not started`** - Render requested before TUI initialization (usually benign)
- **`Render queued`** - A render has been scheduled for next tick
- **`Executing queued render`** - About to perform the actual render
- **`renderToScreen() called: resize=X, termWidth=Y, termHeight=Z`** - Starting render cycle
- **`Reset for resize`** - Terminal was resized, clearing buffers
- **`Collected N render commands, total lines: M`** - Gathered all component output (N components, M total lines)
- **`Performing initial render`** - First render (full screen write)
- **`Performing line-based render`** - Differential render (only changed lines)
- **`Render complete. Total renders: X, avg lines redrawn: Y`** - Render finished with performance stats

### Renderer Debug Messages

**`[RENDERER DEBUG]`** - Agent renderer (TuiRenderer) events

- **`handleStateUpdate: isStreaming=X, messages=N, pendingToolCalls=M`** - Agent state changed
  - `isStreaming=true` - Agent is currently responding
  - `messages=N` - Total messages in conversation
  - `pendingToolCalls=M` - Number of tool calls waiting to execute

- **`Adding N new stable messages`** - N messages were finalized and added to chat history
- **`Streaming message role=X`** - Currently streaming a message with role X (user/assistant/toolResult)
- **`Starting loading animation`** - Spinner started because agent is thinking
- **`Creating streaming component`** - Creating UI component to show live message updates
- **`Streaming stopped`** - Agent finished responding
- **`Requesting render`** - Asking TUI to redraw the screen
- **`simulateInput: "text"`** - Scripted message being typed
- **`Triggering onInputCallback`** - Submitting the scripted message

### Script Debug Messages

**`[SCRIPT]`** - Scripted message playback

- **`Sending message N/M: text`** - Sending message N out of M total
- **`All N messages completed. Exiting.`** - Finished all scripted messages

**`[AGENT]`** - Agent execution

- **`Completed response to: "text"`** - Agent finished processing this message

## Interpreting Debug Output

### Normal Message Flow

```
[RENDERER DEBUG] handleStateUpdate: isStreaming=false, messages=0, pendingToolCalls=0
[SCRIPT] Sending message 1/1: Hello
[RENDERER DEBUG] simulateInput: "Hello"
[RENDERER DEBUG] Triggering onInputCallback
[RENDERER DEBUG] handleStateUpdate: isStreaming=true, messages=1, pendingToolCalls=0
[RENDERER DEBUG] Streaming message role=user
[RENDERER DEBUG] Starting loading animation
[RENDERER DEBUG] Requesting render
[TUI DEBUG] Render queued
[TUI DEBUG] Executing queued render
[TUI DEBUG] renderToScreen() called: resize=false, termWidth=120, termHeight=40
[TUI DEBUG] Collected 4 render commands, total lines: 8
[TUI DEBUG] Performing line-based render
[TUI DEBUG] Render complete. Total renders: 5, avg lines redrawn: 12.4
[RENDERER DEBUG] handleStateUpdate: isStreaming=true, messages=1, pendingToolCalls=0
[RENDERER DEBUG] Streaming message role=assistant
...
[RENDERER DEBUG] handleStateUpdate: isStreaming=false, messages=2, pendingToolCalls=0
[RENDERER DEBUG] Streaming stopped
[RENDERER DEBUG] Adding 1 new stable messages
[AGENT] Completed response to: "Hello"
```

### What to Look For

**Rendering Issues:**
- If `Render queued` appears but no `Executing queued render` → render loop broken
- If `total lines` is 0 or unexpectedly small → components not rendering
- If `avg lines redrawn` is huge → too many full redraws (performance issue)
- If no `[TUI DEBUG]` messages → TUI debug not enabled or TUI not starting

**Message Flow Issues:**
- If messages increase but no "Adding N new stable messages" → renderer not detecting changes
- If `isStreaming=true` never becomes `false` → agent hanging
- If `pendingToolCalls` stays > 0 → tool execution stuck
- If `Streaming stopped` never appears → streaming never completes

**Scripted Message Issues:**
- If `simulateInput` appears but no `Triggering onInputCallback` → callback not registered yet
- If `Sending message` appears but no `Completed response` → agent not responding
- If no `[SCRIPT]` messages → script messages not being processed

## Example Debug Session

```bash
# Test basic rendering with a simple scripted message
coding-agent --debug --script "Hello"

# Test multi-turn conversation
coding-agent --debug --script "Hi" --script "What files are here?" --script "Thanks"

# Test tool execution
coding-agent --debug --script "List all TypeScript files"
```

Look for the flow: script → simulateInput → handleStateUpdate → render → completed
