## `gpt-oss` vLLM Usage Guide

`gpt-oss-20b` and `gpt-oss-120b` are powerful reasoning models open-sourced by OpenAI.
In vLLM, you can run it on NVIDIA H100, H200, B200 as well as MI300x, MI325x, MI355x and Radeon AI PRO R9700.
We are actively working on ensuring this model can work on Ampere, Ada Lovelace, and RTX 5090.
Specifically, vLLM optimizes for `gpt-oss` family of models with

* **Flexible parallelism options**: the model can be sharded across 2, 4, 8 GPUs, scaling throughput.
* **High performance attention and MoE kernels**: attention kernel is specifically optimized for the attention sinks mechanism and sliding window shapes.
* **Asynchronous scheduling**: optimizing for maximum utilization and high throughput by overlapping CPU operations with GPU operations.

This is a living document and we welcome contributions, corrections, and creation of new recipes!

## Quickstart

### Installation

We highly recommend using a new virtual environment, as the first iteration of the release requires cutting edge kernels from various dependencies, these might not work with other models. In particular, we will be installing: a prerelease version of vLLM, PyTorch nightly, Triton nightly, FlashInfer prerelease, HuggingFace prerelease, Harmony, and gpt-oss library tools.

```
uv venv
source .venv/bin/activate

uv pip install --pre vllm==0.10.1+gptoss \
    --extra-index-url https://wheels.vllm.ai/gpt-oss/ \
    --extra-index-url https://download.pytorch.org/whl/nightly/cu128 \
    --index-strategy unsafe-best-match
```

We also provide a docker container with all the dependencies built in

```
docker run --gpus all \
    -p 8000:8000 \
    --ipc=host \
    vllm/vllm-openai:gptoss \
    --model openai/gpt-oss-20b
```

### H100 & H200

You can serve the model with its default parameters:

* `--async-scheduling` can be enabled for higher performance. Currently it is not compatible with structured output.
* We recommend TP=2 for H100 and H200 as the best performance tradeoff point.

```
# openai/gpt-oss-20b should run in single GPU
vllm serve openai/gpt-oss-20b --async-scheduling

# gpt-oss-120b will fit in a single H100/H200, but scaling it to higher TP sizes can help with throughput
vllm serve openai/gpt-oss-120b --async-scheduling
vllm serve openai/gpt-oss-120b --tensor-parallel-size 2 --async-scheduling
vllm serve openai/gpt-oss-120b --tensor-parallel-size 4 --async-scheduling
```

### B200

NVIDIA Blackwell requires installation of FlashInfer library and several environments to enable the necessary kernels. We recommend TP=1 as a starting point for a performant option. We are actively working on the performance of vLLM on Blackwell.

```
# All 3 of these are required
export VLLM_USE_TRTLLM_ATTENTION=1
export VLLM_USE_TRTLLM_DECODE_ATTENTION=1
export VLLM_USE_TRTLLM_CONTEXT_ATTENTION=1

# Pick only one out of the two.
# mxfp8 activation for MoE. faster, but higher risk for accuracy.
export VLLM_USE_FLASHINFER_MXFP4_MOE=1
# bf16 activation for MoE. matching reference precision.
export VLLM_USE_FLASHINFER_MXFP4_BF16_MOE=1

# openai/gpt-oss-20b
vllm serve openai/gpt-oss-20b --async-scheduling

# gpt-oss-120b
vllm serve openai/gpt-oss-120b --async-scheduling
vllm serve openai/gpt-oss-120b --tensor-parallel-size 2 --async-scheduling
vllm serve openai/gpt-oss-120b --tensor-parallel-size 4 --async-scheduling
```

### AMD

ROCm supports OpenAI gpt-oss-120b or gpt-oss-20b models on these 3 different GPUs on day one, along with the pre-built docker containers:

* gfx950: MI350x series, `rocm/vllm-dev:open-mi355-08052025`
* gfx942: MI300x/MI325 series, `rocm/vllm-dev:open-mi300-08052025`
* gfx1201: Radeon AI PRO R9700, `rocm/vllm-dev:open-r9700-08052025`

To run the container:

```
alias drun='sudo docker run -it --network=host --device=/dev/kfd --device=/dev/dri --group-add=video --ipc=host --cap-add=SYS_PTRACE --security-opt seccomp=unconfined --shm-size 32G -v /data:/data -v $HOME:/myhome -w /myhome'

drun rocm/vllm-dev:open-mi300-08052025
```

For MI300x and R9700:

```
export VLLM_ROCM_USE_AITER=1
export VLLM_USE_AITER_UNIFIED_ATTENTION=1
export VLLM_ROCM_USE_AITER_MHA=0

vllm serve openai/gpt-oss-120b --compilation-config '{"full_cuda_graph": true}'
```

For MI355x:

```
# MoE preshuffle, fusion and Triton GEMM flags
export VLLM_USE_AITER_TRITON_FUSED_SPLIT_QKV_ROPE=1
export VLLM_USE_AITER_TRITON_FUSED_ADD_RMSNORM_PAD=1
export VLLM_USE_AITER_TRITON_GEMM=1
export VLLM_ROCM_USE_AITER=1
export VLLM_USE_AITER_UNIFIED_ATTENTION=1
export VLLM_ROCM_USE_AITER_MHA=0
export TRITON_HIP_PRESHUFFLE_SCALES=1

vllm serve openai/gpt-oss-120b --compilation-config '{"compile_sizes": [1, 2, 4, 8, 16, 24, 32, 64, 128, 256, 4096, 8192], "full_cuda_graph": true}' --block-size 64
```

## Usage

Once the `vllm serve` runs and `INFO: Application startup complete` has been displayed, you can send requests using HTTP request or OpenAI SDK to the following endpoints:

* `/v1/responses` endpoint can perform tool use (browsing, python, mcp) in between chain-of-thought and deliver a final response. This endpoint leverages the `openai-harmony` library for input rendering and output parsing. Stateful operation and full streaming API are work in progress. Responses API is recommended by OpenAI as the way to interact with this model.
* `/v1/chat/completions` endpoint offers a familiar interface to this model. No tool will be invoked but reasoning and final text output will be returned structurally. Function calling is work in progress. You can also set the parameter `include_reasoning: false` in request parameter to skip CoT being part of the output.
* `/v1/completions` endpoint is the endpoint for a simple input output interface without any sorts of template rendering.

All endpoints accept `stream: true` as part of the operations to enable incremental token streaming. Please note that vLLM currently does not cover the full scope of responses API, for more detail, please see Limitation section below.

### Tool Use

One premier feature of gpt-oss is the ability to call tools directly, called "built-in tools". In vLLM, we offer several options:

* By default, we integrate with the reference library's browser (with `ExaBackend`) and demo Python interpreter via docker container. In order to use the search backend, you need to get access to [exa.ai](http://exa.ai) and put `EXA_API_KEY=` as an environment variable. For Python, either have docker available, or set `PYTHON_EXECUTION_BACKEND=UV` to dangerously allow execution of model generated code snippets to be executed on the same machine.

```
uv pip install gpt-oss

vllm serve ... --tool-server demo
```

* Please note that the default options are simply for demo purposes. For production usage, vLLM itself can act as MCP client to multiple services.
Here is an [example tool server](https://github.com/openai/gpt-oss/tree/main/gpt-oss-mcp-server) that vLLM can work with, they wrap the demo tools:

```
mcp run -t sse browser_server.py:mcp
mcp run -t sse python_server.py:mcp

vllm serve ... --tool-server ip-1:port-1,ip-2:port-2
```

The URLs are expected to be MCP SSE servers that implement `instructions` in server info and well documented tools. The tools will be injected into the system prompt for the model to enable them.

## Accuracy Evaluation Panels

OpenAI recommends using the gpt-oss reference library to perform evaluation. For example,

```
python -m gpt_oss.evals --model 120b-low --eval gpqa --n-threads 128
python -m gpt_oss.evals --model 120b --eval gpqa --n-threads 128
python -m gpt_oss.evals --model 120b-high --eval gpqa --n-threads 128
```
To eval on AIME2025, change `gpqa` to `aime25`.
With vLLM deployed:

```
# Example deployment on 8xH100
vllm serve openai/gpt-oss-120b \
  --tensor_parallel_size 8 \
  --max-model-len 131072 \
  --max-num-batched-tokens 10240 \
  --max-num-seqs 128 \
  --gpu-memory-utilization 0.85 \
  --no-enable-prefix-caching
```

Here is the score we were able to reproduce without tool use, and we encourage you to try reproducing it as well!
We’ve observed that the numbers may vary slightly across runs, so feel free to run the evaluation multiple times to get a sense of the variance.
For a quick correctness check, we recommend starting with the low reasoning effort setting (120b-low), which should complete within minutes.

Model: 120B

| Reasoning Effort | GPQA | AIME25 |
| :---- | :---- | :---- |
| Low  | 65.3 | 51.2 |
| Mid  | 72.4 | 79.6 |
| High  | 79.4 | 93.0 |

Model: 20B

| Reasoning Effort | GPQA | AIME25 |
| :---- | :---- | :---- |
| Low  | 56.8 | 38.8 |
| Mid  | 67.5 | 75.0 |
| High  | 70.9 | 85.8  |

## Known Limitations

* On H100 using tensor parallel size 1, default gpu memory utilization, and batched token will cause CUDA Out-of-memory. When running tp1, please increase your gpu memory utilization or lower batched token

```
vllm serve openai/gpt-oss-120b --gpu-memory-utilization 0.95 --max-num-batched-tokens 1024
```

* When running TP2 on H100, set your gpu memory utilization below 0.95 as that will also cause OOM
* Responses API has several limitations at the current moment; we strongly welcome contribution and maintenance of this service in vLLM
* Usage accounting is currently broken and only returns all zeros.
* Annotations (citing URLs from search results) are not supported.
* Truncation by `max_tokens` might not be able to preserve partial chunks.
* Streaming is fairly barebone at the moment, for example:
  * Item id and indexing needs more work
  * Tool invocation and output are not properly streamed, rather batched.
  * Proper error handling is missing.

## Troubleshooting

- Attention sink dtype error on Blackwell:

```
  ERROR 08-05 07:31:10 [multiproc_executor.py:559]     assert sinks.dtype == torch.float32, "Sinks must be of type float32"
  **(VllmWorker TP0 pid=174579)** ERROR 08-05 07:31:10 [multiproc_executor.py:559]            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  **(VllmWorker TP0 pid=174579)** ERROR 08-05 07:31:10 [multiproc_executor.py:559] AssertionError: Sinks must be of type float32
```

**Solution: Please refer to Blackwell section to check if related environment variables are added.**

- Triton issue related to `tl.language` not defined:

**Solution: Make sure there's no other triton installed in your environment (pytorch-triton, etc).**

