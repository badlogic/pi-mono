# x402 Provider Extension (Draft)

This extension registers an `x402` provider in Pi with:

- Env-only configuration
- Static model registration
- Single-wallet assumptions
- Foundational modules for router config parsing, permit cache, and 401/402 retry helpers

## Usage

```bash
X402_PRIVATE_KEY=0x... \
X402_ROUTER_URL=http://localhost:8080 \
X402_PAYMENT_SIGNATURE=<base64-x402-payload> \
pi -e ./packages/coding-agent/examples/extensions/custom-provider-x402
```

## Environment Variables

- `X402_PRIVATE_KEY` (required): wallet private key format validation
- `X402_ROUTER_URL` (optional): defaults to `http://localhost:8080`
- `X402_NETWORK` (optional): defaults to `eip155:8453`
- `X402_PERMIT_CAP` (optional): defaults to `10000000` (base units)
- `X402_PAYMENT_HEADER` (optional): defaults to `PAYMENT-SIGNATURE`
- `X402_MODEL_ID` (optional): defaults to `x402/gpt-4.1-mini`
- `X402_MODEL_NAME` (optional): defaults to `x402 GPT-4.1 Mini`
- `X402_PAYMENT_SIGNATURE` (optional): static payment signature header value

## Status

This is Phase 1 groundwork for a full x402 provider. The deterministic modules under `src/` are test-covered and ready for integration with local permit signing and streamed retry orchestration.
