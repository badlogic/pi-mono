// Declare browser global for Firefox
declare const browser: any;

// Detect browser type
const isFirefox = typeof browser !== "undefined" && typeof browser.runtime !== "undefined";

// Open side panel/sidebar when extension icon is clicked
if (isFirefox) {
	// Firefox MV2: Use browserAction
	if (browser.browserAction) {
		browser.browserAction.onClicked.addListener(() => {
			if (browser.sidebarAction) {
				browser.sidebarAction.toggle();
			}
		});
	}
} else {
	// Chrome MV3: Use action API
	chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
		if (tab.id && chrome.sidePanel) {
			chrome.sidePanel.open({ tabId: tab.id });
		}
	});
}

export {};
