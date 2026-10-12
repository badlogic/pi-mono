import { Type } from "typebox";
import { method, remote } from "../../src/index.ts";

export const Echo = remote("t.echo", {
	version: 1,
	input: Type.Object({}),
	variants: {
		main: { methods: { echo: method(Type.String(), Type.String()), pid: method(Type.Null(), Type.Number()) } },
	},
});
