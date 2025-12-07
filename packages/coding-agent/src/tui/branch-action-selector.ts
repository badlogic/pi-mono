import { Container, type SelectItem, SelectList } from "@mariozechner/pi-tui";
import { getSelectListTheme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export type BranchAction = "conversation" | "code" | "both";

/**
 * Component that renders an action selector for branching with checkpoint restore options.
 * Only shown when a checkpoint exists for the selected message.
 */
export class BranchActionSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(onSelect: (action: BranchAction) => void, onCancel: () => void) {
		super();

		const actions: SelectItem[] = [
			{
				value: "both",
				label: "Restore all",
				description: "Restore files and branch conversation",
			},
			{
				value: "conversation",
				label: "Conversation only",
				description: "Branch conversation, keep current files",
			},
			{
				value: "code",
				label: "Code only",
				description: "Restore files, keep current conversation",
			},
		];

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(actions, actions.length, getSelectListTheme());
		this.selectList.onSelect = (item) => {
			onSelect(item.value as BranchAction);
		};
		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
