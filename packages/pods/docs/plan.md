## Pi

Pi automates vLLM deployment on GPU pods from DataCrunch, Vast.ai, Prime Intellect, RunPod (or any Ubuntu machine with NVIDIA GPUs). It manages multiple concurrent model deployments via separate vLLM instances, each accessible through the OpenAI API protocol with API key authentication.

Pods are treated as ephemeral - spin up when needed, tear down when done. To avoid re-downloading models (30+ minutes for 100GB+ models), pi uses persistent network volumes for model storage that can be shared across pods on the same provider. This minimizes both cost (only pay for active compute) and setup time (models already cached).

## Usage

### Pods
```bash
pi pods setup dc1 "ssh root@1.2.3.4" --mount "mount -t nfs..."  # Setup pod (requires HF_TOKEN, PI_API_KEY env vars)
pi pods                              # List all pods (* = active)
pi pods active dc2                   # Switch active pod
pi pods remove dc1                   # Remove pod
```

### Models
```bash
pi start Qwen/Qwen2.5-72B-Instruct --name qwen72b          # Known model - pi handles vLLM args
pi start some/unknown-model --name mymodel --vllm --tensor-parallel-size 4 --max-model-len 32768  # Custom vLLM args
pi list                              # List running models with ports
pi stop qwen72b                      # Stop model
pi logs qwen72b                      # View model logs
```

For known models, pi automatically configures appropriate vLLM arguments from model documentation based on the hardware of the pod. For unknown models or custom configurations, pass vLLM args after `--vllm`.

## Pod management

Pi manages GPU pods from various providers (DataCrunch, Vast.ai, Prime Intellect, RunPod) as ephemeral compute resources. Users manually create pods via provider dashboards, then register them with pi for automated setup and management.

Key capabilities:
- **Pod setup**: Transform bare Ubuntu/Debian machines into vLLM-ready environments in ~2 minutes
- **Model caching**: Optional persistent storage shared by pods to avoid re-downloading 100GB+ models
- **Multi-pod management**: Register multiple pods, switch between them, maintain different environments

### Pod setup

When a user creates a fresh pod on a provider, they register it with pi using the SSH command from the provider:

```bash
pi pods setup dc1 "ssh root@1.2.3.4" --mount "mount -t nfs..."
```

This copies and executes `pod_setup.sh` which:
1. Detects GPUs via `nvidia-smi` and stores count/memory in local config
2. Installs CUDA toolkit matching the driver version
3. Creates Python environment
   - Installs uv and Python 3.12
   - Creates venv at ~/venv with PyTorch (--torch-backend=auto)
   - Installs vLLM (model-specific versions when needed)
   - Installs FlashInfer (builds from source if required)
   - Installs huggingface-hub (for model downloads)
   - Installs hf-transfer (for accelerated downloads)
4. Mounts persistent storage if provided
   - Symlinks to ~/.cache/huggingface for model caching
5. Configures environment variables persistently

Required environment variables:
- `HF_TOKEN`: HuggingFace token for model downloads
- `PI_API_KEY`: API key for securing vLLM endpoints

### Model caching

Models can be 100GB+ and take 30+ minutes to download. The `--mount` flag enables persistent model caching:

- **DataCrunch**: NFS shared filesystems, mountable across multiple running pods in same region
- **RunPod**: Network volumes persist independently but cannot be shared between running pods
- **Vast.ai**: Volumes locked to specific machine - no sharing
- **Prime Intellect**: No persistent storage documented

Without `--mount`, models download to pod-local storage and are lost on termination.

### Multi-pod management

Users can register multiple pods and switch between them:

```bash
pi pods                    # List all pods (* = active)
pi pods active dc2         # Switch active pod
pi pods remove dc1         # Remove pod from local config but doesn't destroy pod remotely.
```

All model commands (`pi start`, `pi stop`, etc.) target the active pod, unless `--pod <podname>` is given, which overrides the active pod for that command.

## Model deployment

Pi uses direct SSH commands to manage vLLM instances on pods. No remote manager component is needed - everything is controlled from the local pi CLI.

### Architecture
The pi CLI maintains all state locally in `~/.pi/pods.json`:
```json
{
  "pods": {
    "dc1": {
      "ssh": "ssh root@1.2.3.4",
      "gpus": [
        {"id": 0, "name": "H100", "memory": "80GB"},
        {"id": 1, "name": "H100", "memory": "80GB"}
      ],
      "models": {
        "qwen": {
          "model": "Qwen/Qwen2.5-72B",
          "port": 8001,
          "gpu": "0",
          "pid": 12345
        }
      }
    }
  },
  "active": "dc1"
}
```

The location of the pi config dir can also be specified via the `PI_CONFIG_DIR` env var, e.g. for testing.

Pods are assumed to be fully managed by pi - no other processes compete for ports or GPUs.

### Starting models
When user runs `pi start Qwen/Qwen2.5-72B --name qwen`:
1. CLI determines next available port (starting from 8001)
2. Selects GPU (round-robin based on stored GPU info)
3. Downloads model if not cached:
   - Sets `HF_HUB_ENABLE_HF_TRANSFER=1` for fast downloads
   - Runs via SSH with output piped to local terminal
   - Ctrl+C cancels download and returns control
4. Builds vLLM command with appropriate args and PI_API_KEY
5. Executes via SSH: `ssh pod "nohup vllm serve ... > ~/.vllm_logs/qwen.log 2>&1 & echo $!"`
6. Waits for vLLM to be ready (checks health endpoint)
7. On success: stores port, GPU, PID in local state
8. On failure: shows exact error from vLLM logs, doesn't save to config

### Managing models
- **List**: Show models from local state, optionally verify PIDs still running
- **Stop**: SSH to kill process by PID
- **Logs**: SSH to tail -f log files (Ctrl+C stops tailing, doesn't kill vLLM)

### Error handling
- **SSH failures**: Prompt user to check connection or remove pod from config
- **Stale state**: Commands that fail with "process not found" auto-clean local state
- **Setup failures**: Ctrl+C during setup kills remote script and exits cleanly

### Testing models
The `pi prompt` command provides a quick way to test deployed models:
```bash
pi prompt qwen "What is 2+2?"                    # Simple prompt
pi prompt qwen "Read file.txt and summarize"     # Uses built-in tools
```

Built-in tools for agentic testing:
- `ls(path, ignore?)`: List files and directories at path, with optional ignore patterns
- `read(file_path, offset?, limit?)`: Read file contents with optional line offset/limit
- `glob(pattern, path?)`: Find files matching glob pattern (e.g., "**/*.py", "src/**/*.ts")
- `rg(args)`: Run ripgrep with any arguments (e.g., "pattern -t py -C 3", "TODO --type-not test")

The provided prompt will be augmented with info on the current local working directory. File tools expect absolute paths.

This allows testing basic agent capabilities without external tool configuration.

`prompt` is implemented using the latest OpenAI SDK for NodeJS. It outputs thinking content, tool calls and results, and normal assistant messages.

## Models
We want to support these models specifically, with alternative models being marked as "possibly works". This list will be updated with new models regularly. A checked
box means "supported".

See [models.md](./models.md) for a list of models, their HW reqs, vLLM args and notes, we want to support out of the box with a simple `pi start <model-name> --name <local-name>`