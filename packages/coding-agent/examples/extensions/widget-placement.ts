import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const applyWidgets = (ctx: ExtensionContext) => {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget("widget-above", ["Above editor widget"]);
	ctx.ui.setWidget("widget-below", ["Below editor widget"], { placement: "belowEditor" });
};

export default function widgetPlacementExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		applyWidgets(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		applyWidgets(ctx);
	});
}
