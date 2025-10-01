// Declare browser global for Firefox
declare const browser: any;

// Detect browser type
const isFirefox = typeof browser !== "undefined" && typeof browser.runtime !== "undefined";
const browserAPI = isFirefox ? browser : chrome;

// Open side panel/sidebar when extension icon is clicked
browserAPI.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
	if (isFirefox) {
		// Firefox: Toggle the sidebar
		if (typeof browser !== "undefined" && browser.sidebarAction) {
			browser.sidebarAction.toggle();
		}
	} else {
		// Chrome: Open the side panel
		if (tab.id && chrome.sidePanel) {
			chrome.sidePanel.open({ tabId: tab.id });
		}
	}
});

export {};
