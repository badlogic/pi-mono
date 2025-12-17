import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Sleep for a specified number of milliseconds",
  args: {
    ms: tool.schema.number().describe("Number of milliseconds to sleep"),
  },
  async execute(args, context) {
    if (context.abort.aborted) {
      throw new Error("Sleep aborted")
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, args.ms)
      const onAbort = () => {
        clearTimeout(timeout)
        reject(new Error("Sleep aborted"))
      }
      context.abort.addEventListener("abort", onAbort, { once: true })
    })
    return `Slept for ${args.ms}ms`
  },
})
