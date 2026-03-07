import type { Readable } from "node:stream";

export function serializeRpcJsonLine(obj: unknown): string {
	return `${JSON.stringify(obj).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")}\n`;
}

export function attachLfLineReader(stream: Readable, onLine: (line: string) => void): () => void {
	let buffer = "";

	const onData = (chunk: string | Buffer) => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

		while (true) {
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex < 0) break;

			let line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			onLine(line);
		}
	};

	const onEnd = () => {
		if (!buffer) return;
		let line = buffer;
		buffer = "";
		if (line.endsWith("\r")) line = line.slice(0, -1);
		if (line) onLine(line);
	};

	stream.on("data", onData);
	stream.on("end", onEnd);

	return () => {
		stream.off("data", onData);
		stream.off("end", onEnd);
	};
}
