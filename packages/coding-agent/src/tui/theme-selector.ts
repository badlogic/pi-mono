import { Container, type SelectItem, SelectList } from "@mariozechner/pi-tui";
import { getAvailableThemes, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/**
 * Component that renders a theme selector
 */
export class ThemeSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(currentTheme: string, onSelect: (themeName: string) => void, onCancel: () => void) {
		super();

		// Get available themes and create select items
		const themes = getAvailableThemes();
		const themeItems: SelectItem[] = themes.map((name) => ({
			value: name,
			label: name,
			description: name === currentTheme ? "(current)" : undefined,
		}));

		// Add top border
		this.addChild(new DynamicBorder((text) => theme.fg("border", text)));

		// Create selector
		this.selectList = new SelectList(themeItems, 10);

		// Preselect current theme
		const currentIndex = themes.indexOf(currentTheme);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new DynamicBorder((text) => theme.fg("border", text)));
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
