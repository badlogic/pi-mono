import { Container, type SelectItem, SelectList } from "@mariozechner/pi-tui";
import { detectSystemAppearance, getAvailableThemes, getCurrentThemeName, getSelectListTheme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/**
 * Component that renders a theme selector
 */
export class ThemeSelectorComponent extends Container {
	private selectList: SelectList;
	private onPreview: (themeName: string) => void;

	constructor(
		currentThemeSetting: string,
		onSelect: (themeName: string) => void,
		onCancel: () => void,
		onPreview: (themeName: string) => void,
	) {
		super();
		this.onPreview = onPreview;

		// Get available themes and create select items
		const themes = getAvailableThemes();

		// Build auto description
		let autoDescription = "(follows system)";
		if (currentThemeSetting === "auto") {
			const resolved = getCurrentThemeName();
			autoDescription = resolved ? `(follows system, currently: ${resolved})` : "(follows system)";
		} else if (detectSystemAppearance()) {
			// Show what it would resolve to
			const systemAppearance = detectSystemAppearance();
			autoDescription = `(follows system, would use: ${systemAppearance})`;
		}

		// Create theme items with "auto" at the top
		const themeItems: SelectItem[] = [
			{
				value: "auto",
				label: "auto",
				description: currentThemeSetting === "auto" ? `${autoDescription} (current)` : autoDescription,
			},
			...themes.map((name) => ({
				value: name,
				label: name,
				description: name === currentThemeSetting ? "(current)" : undefined,
			})),
		];

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.selectList = new SelectList(themeItems, 10, getSelectListTheme());

		// Preselect current theme setting
		if (currentThemeSetting === "auto") {
			this.selectList.setSelectedIndex(0);
		} else {
			const currentIndex = themes.indexOf(currentThemeSetting);
			if (currentIndex !== -1) {
				// +1 because "auto" is at index 0
				this.selectList.setSelectedIndex(currentIndex + 1);
			}
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.selectList.onSelectionChange = (item) => {
			this.onPreview(item.value);
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
