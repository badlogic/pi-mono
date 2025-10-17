import { defaultEnglish, defaultGerman, type MiniLitRequiredMessages, setTranslations } from "@mariozechner/mini-lit";

declare module "@mariozechner/mini-lit" {
	interface i18nMessages extends MiniLitRequiredMessages {
		Free: string;
		"Input Required": string;
		Cancel: string;
		Confirm: string;
		"Select Model": string;
		"Search models...": string;
		Format: string;
		Thinking: string;
		Vision: string;
		You: string;
		Assistant: string;
		"Thinking...": string;
		"Type your message...": string;
		"API Keys Configuration": string;
		"Configure API keys for LLM providers. Keys are stored locally in your browser.": string;
		Configured: string;
		"Not configured": string;
		"✓ Valid": string;
		"✗ Invalid": string;
		"Testing...": string;
		Update: string;
		Test: string;
		Remove: string;
		Save: string;
		"Update API key": string;
		"Enter API key": string;
		"Type a message...": string;
		"Failed to fetch file": string;
		"Invalid source type": string;
		PDF: string;
		Document: string;
		Presentation: string;
		Spreadsheet: string;
		Text: string;
		"Error loading file": string;
		"No text content available": string;
		"Failed to load PDF": string;
		"Failed to load document": string;
		"Failed to load spreadsheet": string;
		"Error loading PDF": string;
		"Error loading document": string;
		"Error loading spreadsheet": string;
		"Preview not available for this file type.": string;
		"Click the download button above to view it on your computer.": string;
		"No content available": string;
		"Failed to display text content": string;
		"API keys are required to use AI models. Get your keys from the provider's website.": string;
		console: string;
		"Copy output": string;
		"Copied!": string;
		"Error:": string;
		"Request aborted": string;
		Call: string;
		Result: string;
		"(no result)": string;
		"Waiting for tool result…": string;
		"Call was aborted; no result.": string;
		"No session available": string;
		"No session set": string;
		"Preparing tool parameters...": string;
		"(no output)": string;
		"Writing expression...": string;
		"Waiting for expression...": string;
		Calculating: string;
		"Getting current time in": string;
		"Getting current date and time": string;
		"Waiting for command...": string;
		"Writing command...": string;
		"Running command...": string;
		"Command failed:": string;
		"Enter Auth Token": string;
		"Please enter your auth token.": string;
		"Auth token is required for proxy transport": string;
		// JavaScript REPL strings
		"Execution aborted": string;
		"Code parameter is required": string;
		"Unknown error": string;
		"Code executed successfully (no output)": string;
		"Execution failed": string;
		"JavaScript REPL": string;
		"JavaScript code to execute": string;
		"Writing JavaScript code...": string;
		"Executing JavaScript": string;
		"Preparing JavaScript...": string;
		"Preparing command...": string;
		"Preparing calculation...": string;
		"Preparing tool...": string;
		"Getting time...": string;
		// Artifacts strings
		"Processing artifact...": string;
		"Preparing artifact...": string;
		"Processing artifact": string;
		"Processed artifact": string;
		"Creating artifact": string;
		"Created artifact": string;
		"Updating artifact": string;
		"Updated artifact": string;
		"Rewriting artifact": string;
		"Rewrote artifact": string;
		"Getting artifact": string;
		"Got artifact": string;
		"Deleting artifact": string;
		"Deleted artifact": string;
		"Getting logs": string;
		"Got logs": string;
		"An error occurred": string;
		"Copy logs": string;
		"Autoscroll enabled": string;
		"Autoscroll disabled": string;
		Processing: string;
		Create: string;
		Rewrite: string;
		Get: string;
		Delete: string;
		"Get logs": string;
		"Show artifacts": string;
		"Close artifacts": string;
		Artifacts: string;
		"Copy HTML": string;
		"Download HTML": string;
		"Reload HTML": string;
		"Copy SVG": string;
		"Download SVG": string;
		"Copy Markdown": string;
		"Download Markdown": string;
		Download: string;
		"No logs for {filename}": string;
		"API Keys Settings": string;
		Settings: string;
		"API Keys": string;
		Proxy: string;
		"Use CORS Proxy": string;
		"Proxy URL": string;
		"Settings are stored locally in your browser": string;
		Clear: string;
		"API Key Required": string;
		"Enter your API key for {provider}": string;
		"The CORS proxy strips CORS headers from API responses, allowing browser-based apps to make direct calls to LLM providers without CORS restrictions. It forwards requests to providers while removing headers that would otherwise block cross-origin requests.": string;
		Off: string;
		Minimal: string;
		Low: string;
		Medium: string;
		High: string;
		"Storage Permission Required": string;
		"This app needs persistent storage to save your conversations": string;
		"Why is this needed?": string;
		"Without persistent storage, your browser may delete saved conversations when it needs disk space. Granting this permission ensures your chat history is preserved.": string;
		"What this means:": string;
		"Your conversations will be saved locally in your browser": string;
		"Data will not be deleted automatically to free up space": string;
		"You can still manually clear data at any time": string;
		"No data is sent to external servers": string;
		"Continue Anyway": string;
		"Requesting...": string;
		"Grant Permission": string;
		Sessions: string;
		"Load a previous conversation": string;
		"No sessions yet": string;
		"Delete this session?": string;
		Today: string;
		Yesterday: string;
		"{days} days ago": string;
		messages: string;
		tokens: string;
		"Drop files here": string;
	}
}

export const translations = {
	en: {
		...defaultEnglish,
		Free: "Free",
		"Input Required": "Input Required",
		Cancel: "Cancel",
		Confirm: "Confirm",
		"Select Model": "Select Model",
		"Search models...": "Search models...",
		Format: "Format",
		Thinking: "Thinking",
		Vision: "Vision",
		You: "You",
		Assistant: "Assistant",
		"Thinking...": "Thinking...",
		"Type your message...": "Type your message...",
		"API Keys Configuration": "API Keys Configuration",
		"Configure API keys for LLM providers. Keys are stored locally in your browser.":
			"Configure API keys for LLM providers. Keys are stored locally in your browser.",
		Configured: "Configured",
		"Not configured": "Not configured",
		"✓ Valid": "✓ Valid",
		"✗ Invalid": "✗ Invalid",
		"Testing...": "Testing...",
		Update: "Update",
		Test: "Test",
		Remove: "Remove",
		Save: "Save",
		"Update API key": "Update API key",
		"Enter API key": "Enter API key",
		"Type a message...": "Type a message...",
		"Failed to fetch file": "Failed to fetch file",
		"Invalid source type": "Invalid source type",
		PDF: "PDF",
		Document: "Document",
		Presentation: "Presentation",
		Spreadsheet: "Spreadsheet",
		Text: "Text",
		"Error loading file": "Error loading file",
		"No text content available": "No text content available",
		"Failed to load PDF": "Failed to load PDF",
		"Failed to load document": "Failed to load document",
		"Failed to load spreadsheet": "Failed to load spreadsheet",
		"Error loading PDF": "Error loading PDF",
		"Error loading document": "Error loading document",
		"Error loading spreadsheet": "Error loading spreadsheet",
		"Preview not available for this file type.": "Preview not available for this file type.",
		"Click the download button above to view it on your computer.":
			"Click the download button above to view it on your computer.",
		"No content available": "No content available",
		"Failed to display text content": "Failed to display text content",
		"API keys are required to use AI models. Get your keys from the provider's website.":
			"API keys are required to use AI models. Get your keys from the provider's website.",
		console: "console",
		"Copy output": "Copy output",
		"Copied!": "Copied!",
		"Error:": "Error:",
		"Request aborted": "Request aborted",
		Call: "Call",
		Result: "Result",
		"(no result)": "(no result)",
		"Waiting for tool result…": "Waiting for tool result…",
		"Call was aborted; no result.": "Call was aborted; no result.",
		"No session available": "No session available",
		"No session set": "No session set",
		"Preparing tool parameters...": "Preparing tool parameters...",
		"(no output)": "(no output)",
		"Waiting for expression...": "Waiting for expression...",
		"Writing expression...": "Writing expression...",
		Calculating: "Calculating",
		"Getting current time in": "Getting current time in",
		"Getting current date and time": "Getting current date and time",
		"Waiting for command...": "Waiting for command...",
		"Writing command...": "Writing command...",
		"Running command...": "Running command...",
		"Command failed": "Command failed",
		"Enter Auth Token": "Enter Auth Token",
		"Please enter your auth token.": "Please enter your auth token.",
		"Auth token is required for proxy transport": "Auth token is required for proxy transport",
		// JavaScript REPL strings
		"Execution aborted": "Execution aborted",
		"Code parameter is required": "Code parameter is required",
		"Unknown error": "Unknown error",
		"Code executed successfully (no output)": "Code executed successfully (no output)",
		"Execution failed": "Execution failed",
		"JavaScript REPL": "JavaScript REPL",
		"JavaScript code to execute": "JavaScript code to execute",
		"Writing JavaScript code...": "Writing JavaScript code...",
		"Executing JavaScript": "Executing JavaScript",
		"Preparing JavaScript...": "Preparing JavaScript...",
		"Preparing command...": "Preparing command...",
		"Preparing calculation...": "Preparing calculation...",
		"Preparing tool...": "Preparing tool...",
		"Getting time...": "Getting time...",
		// Artifacts strings
		"Processing artifact...": "Processing artifact...",
		"Preparing artifact...": "Preparing artifact...",
		"Processing artifact": "Processing artifact",
		"Processed artifact": "Processed artifact",
		"Creating artifact": "Creating artifact",
		"Created artifact": "Created artifact",
		"Updating artifact": "Updating artifact",
		"Updated artifact": "Updated artifact",
		"Rewriting artifact": "Rewriting artifact",
		"Rewrote artifact": "Rewrote artifact",
		"Getting artifact": "Getting artifact",
		"Got artifact": "Got artifact",
		"Deleting artifact": "Deleting artifact",
		"Deleted artifact": "Deleted artifact",
		"Getting logs": "Getting logs",
		"Got logs": "Got logs",
		"An error occurred": "An error occurred",
		"Copy logs": "Copy logs",
		"Autoscroll enabled": "Autoscroll enabled",
		"Autoscroll disabled": "Autoscroll disabled",
		Processing: "Processing",
		Create: "Create",
		Rewrite: "Rewrite",
		Get: "Get",
		"Get logs": "Get logs",
		"Show artifacts": "Show artifacts",
		"Close artifacts": "Close artifacts",
		Artifacts: "Artifacts",
		"Copy HTML": "Copy HTML",
		"Download HTML": "Download HTML",
		"Reload HTML": "Reload HTML",
		"Copy SVG": "Copy SVG",
		"Download SVG": "Download SVG",
		"Copy Markdown": "Copy Markdown",
		"Download Markdown": "Download Markdown",
		Download: "Download",
		"No logs for {filename}": "No logs for {filename}",
		"API Keys Settings": "API Keys Settings",
		Settings: "Settings",
		"API Keys": "API Keys",
		Proxy: "Proxy",
		"Use CORS Proxy": "Use CORS Proxy",
		"Proxy URL": "Proxy URL",
		"Settings are stored locally in your browser": "Settings are stored locally in your browser",
		Clear: "Clear",
		"API Key Required": "API Key Required",
		"Enter your API key for {provider}": "Enter your API key for {provider}",
		"The CORS proxy strips CORS headers from API responses, allowing browser-based apps to make direct calls to LLM providers without CORS restrictions. It forwards requests to providers while removing headers that would otherwise block cross-origin requests.":
			"The CORS proxy strips CORS headers from API responses, allowing browser-based apps to make direct calls to LLM providers without CORS restrictions. It forwards requests to providers while removing headers that would otherwise block cross-origin requests.",
		Off: "Off",
		Minimal: "Minimal",
		Low: "Low",
		Medium: "Medium",
		High: "High",
		"Storage Permission Required": "Storage Permission Required",
		"This app needs persistent storage to save your conversations":
			"This app needs persistent storage to save your conversations",
		"Why is this needed?": "Why is this needed?",
		"Without persistent storage, your browser may delete saved conversations when it needs disk space. Granting this permission ensures your chat history is preserved.":
			"Without persistent storage, your browser may delete saved conversations when it needs disk space. Granting this permission ensures your chat history is preserved.",
		"What this means:": "What this means:",
		"Your conversations will be saved locally in your browser":
			"Your conversations will be saved locally in your browser",
		"Data will not be deleted automatically to free up space":
			"Data will not be deleted automatically to free up space",
		"You can still manually clear data at any time": "You can still manually clear data at any time",
		"No data is sent to external servers": "No data is sent to external servers",
		"Continue Anyway": "Continue Anyway",
		"Requesting...": "Requesting...",
		"Grant Permission": "Grant Permission",
		Sessions: "Sessions",
		"Load a previous conversation": "Load a previous conversation",
		"No sessions yet": "No sessions yet",
		"Delete this session?": "Delete this session?",
		Today: "Today",
		Yesterday: "Yesterday",
		"{days} days ago": "{days} days ago",
		messages: "messages",
		tokens: "tokens",
		Delete: "Delete",
		"Drop files here": "Drop files here",
		"Command failed:": "Command failed:",
	},
	de: {
		...defaultGerman,
		Free: "Kostenlos",
		"Input Required": "Eingabe erforderlich",
		Cancel: "Abbrechen",
		Confirm: "Bestätigen",
		"Select Model": "Modell auswählen",
		"Search models...": "Modelle suchen...",
		Format: "Formatieren",
		Thinking: "Thinking",
		Vision: "Vision",
		You: "Sie",
		Assistant: "Assistent",
		"Thinking...": "Denkt nach...",
		"Type your message...": "Geben Sie Ihre Nachricht ein...",
		"API Keys Configuration": "API-Schlüssel-Konfiguration",
		"Configure API keys for LLM providers. Keys are stored locally in your browser.":
			"Konfigurieren Sie API-Schlüssel für LLM-Anbieter. Schlüssel werden lokal in Ihrem Browser gespeichert.",
		Configured: "Konfiguriert",
		"Not configured": "Nicht konfiguriert",
		"✓ Valid": "✓ Gültig",
		"✗ Invalid": "✗ Ungültig",
		"Testing...": "Teste...",
		Update: "Aktualisieren",
		Test: "Testen",
		Remove: "Entfernen",
		Save: "Speichern",
		"Update API key": "API-Schlüssel aktualisieren",
		"Enter API key": "API-Schlüssel eingeben",
		"Type a message...": "Nachricht eingeben...",
		"Failed to fetch file": "Datei konnte nicht abgerufen werden",
		"Invalid source type": "Ungültiger Quellentyp",
		PDF: "PDF",
		Document: "Dokument",
		Presentation: "Präsentation",
		Spreadsheet: "Tabelle",
		Text: "Text",
		"Error loading file": "Fehler beim Laden der Datei",
		"No text content available": "Kein Textinhalt verfügbar",
		"Failed to load PDF": "PDF konnte nicht geladen werden",
		"Failed to load document": "Dokument konnte nicht geladen werden",
		"Failed to load spreadsheet": "Tabelle konnte nicht geladen werden",
		"Error loading PDF": "Fehler beim Laden des PDFs",
		"Error loading document": "Fehler beim Laden des Dokuments",
		"Error loading spreadsheet": "Fehler beim Laden der Tabelle",
		"Preview not available for this file type.": "Vorschau für diesen Dateityp nicht verfügbar.",
		"Click the download button above to view it on your computer.":
			"Klicken Sie oben auf die Download-Schaltfläche, um die Datei auf Ihrem Computer anzuzeigen.",
		"No content available": "Kein Inhalt verfügbar",
		"Failed to display text content": "Textinhalt konnte nicht angezeigt werden",
		"API keys are required to use AI models. Get your keys from the provider's website.":
			"API-Schlüssel sind erforderlich, um KI-Modelle zu verwenden. Holen Sie sich Ihre Schlüssel von der Website des Anbieters.",
		console: "Konsole",
		"Copy output": "Ausgabe kopieren",
		"Copied!": "Kopiert!",
		"Error:": "Fehler:",
		"Request aborted": "Anfrage abgebrochen",
		Call: "Aufruf",
		Result: "Ergebnis",
		"(no result)": "(kein Ergebnis)",
		"Waiting for tool result…": "Warte auf Tool-Ergebnis…",
		"Call was aborted; no result.": "Aufruf wurde abgebrochen; kein Ergebnis.",
		"No session available": "Keine Sitzung verfügbar",
		"No session set": "Keine Sitzung gesetzt",
		"Preparing tool parameters...": "Bereite Tool-Parameter vor...",
		"(no output)": "(keine Ausgabe)",
		"Waiting for expression...": "Warte auf Ausdruck",
		"Writing expression...": "Schreibe Ausdruck...",
		Calculating: "Berechne",
		"Getting current time in": "Hole aktuelle Zeit in",
		"Getting current date and time": "Hole aktuelles Datum und Uhrzeit",
		"Waiting for command...": "Warte auf Befehl...",
		"Writing command...": "Schreibe Befehl...",
		"Running command...": "Führe Befehl aus...",
		"Command failed": "Befehl fehlgeschlagen",
		"Enter Auth Token": "Auth-Token eingeben",
		"Please enter your auth token.": "Bitte geben Sie Ihr Auth-Token ein.",
		"Auth token is required for proxy transport": "Auth-Token ist für Proxy-Transport erforderlich",
		// JavaScript REPL strings
		"Execution aborted": "Ausführung abgebrochen",
		"Code parameter is required": "Code-Parameter ist erforderlich",
		"Unknown error": "Unbekannter Fehler",
		"Code executed successfully (no output)": "Code erfolgreich ausgeführt (keine Ausgabe)",
		"Execution failed": "Ausführung fehlgeschlagen",
		"JavaScript REPL": "JavaScript REPL",
		"JavaScript code to execute": "Auszuführender JavaScript-Code",
		"Writing JavaScript code...": "Schreibe JavaScript-Code...",
		"Executing JavaScript": "Führe JavaScript aus",
		"Preparing JavaScript...": "Bereite JavaScript vor...",
		"Preparing command...": "Bereite Befehl vor...",
		"Preparing calculation...": "Bereite Berechnung vor...",
		"Preparing tool...": "Bereite Tool vor...",
		"Getting time...": "Hole Zeit...",
		// Artifacts strings
		"Processing artifact...": "Verarbeite Artefakt...",
		"Preparing artifact...": "Bereite Artefakt vor...",
		"Processing artifact": "Verarbeite Artefakt",
		"Processed artifact": "Artefakt verarbeitet",
		"Creating artifact": "Erstelle Artefakt",
		"Created artifact": "Artefakt erstellt",
		"Updating artifact": "Aktualisiere Artefakt",
		"Updated artifact": "Artefakt aktualisiert",
		"Rewriting artifact": "Überschreibe Artefakt",
		"Rewrote artifact": "Artefakt überschrieben",
		"Getting artifact": "Hole Artefakt",
		"Got artifact": "Artefakt geholt",
		"Deleting artifact": "Lösche Artefakt",
		"Deleted artifact": "Artefakt gelöscht",
		"Getting logs": "Hole Logs",
		"Got logs": "Logs geholt",
		"An error occurred": "Ein Fehler ist aufgetreten",
		"Copy logs": "Logs kopieren",
		"Autoscroll enabled": "Automatisches Scrollen aktiviert",
		"Autoscroll disabled": "Automatisches Scrollen deaktiviert",
		Processing: "Verarbeitung",
		Create: "Erstellen",
		Rewrite: "Überschreiben",
		Get: "Abrufen",
		"Get logs": "Logs abrufen",
		"Show artifacts": "Artefakte anzeigen",
		"Close artifacts": "Artefakte schließen",
		Artifacts: "Artefakte",
		"Copy HTML": "HTML kopieren",
		"Download HTML": "HTML herunterladen",
		"Reload HTML": "HTML neu laden",
		"Copy SVG": "SVG kopieren",
		"Download SVG": "SVG herunterladen",
		"Copy Markdown": "Markdown kopieren",
		"Download Markdown": "Markdown herunterladen",
		Download: "Herunterladen",
		"No logs for {filename}": "Keine Logs für {filename}",
		"API Keys Settings": "API-Schlüssel Einstellungen",
		Settings: "Einstellungen",
		"API Keys": "API-Schlüssel",
		Proxy: "Proxy",
		"Use CORS Proxy": "CORS-Proxy verwenden",
		"Proxy URL": "Proxy-URL",
		"Settings are stored locally in your browser": "Einstellungen werden lokal in Ihrem Browser gespeichert",
		Clear: "Löschen",
		"API Key Required": "API-Schlüssel erforderlich",
		"Enter your API key for {provider}": "Geben Sie Ihren API-Schlüssel für {provider} ein",
		"The CORS proxy strips CORS headers from API responses, allowing browser-based apps to make direct calls to LLM providers without CORS restrictions. It forwards requests to providers while removing headers that would otherwise block cross-origin requests.":
			"Der CORS-Proxy entfernt CORS-Header aus API-Antworten und ermöglicht browserbasierte Anwendungen, direkte Aufrufe an LLM-Anbieter ohne CORS-Einschränkungen durchzuführen. Er leitet Anfragen an Anbieter weiter und entfernt Header, die sonst Cross-Origin-Anfragen blockieren würden.",
		Off: "Aus",
		Minimal: "Minimal",
		Low: "Niedrig",
		Medium: "Mittel",
		High: "Hoch",
		"Storage Permission Required": "Speicherberechtigung erforderlich",
		"This app needs persistent storage to save your conversations":
			"Diese App benötigt dauerhaften Speicher, um Ihre Konversationen zu speichern",
		"Why is this needed?": "Warum wird das benötigt?",
		"Without persistent storage, your browser may delete saved conversations when it needs disk space. Granting this permission ensures your chat history is preserved.":
			"Ohne dauerhaften Speicher kann Ihr Browser gespeicherte Konversationen löschen, wenn Speicherplatz benötigt wird. Diese Berechtigung stellt sicher, dass Ihr Chatverlauf erhalten bleibt.",
		"What this means:": "Was das bedeutet:",
		"Your conversations will be saved locally in your browser":
			"Ihre Konversationen werden lokal in Ihrem Browser gespeichert",
		"Data will not be deleted automatically to free up space":
			"Daten werden nicht automatisch gelöscht, um Speicherplatz freizugeben",
		"You can still manually clear data at any time": "Sie können Daten jederzeit manuell löschen",
		"No data is sent to external servers": "Keine Daten werden an externe Server gesendet",
		"Continue Anyway": "Trotzdem fortfahren",
		"Requesting...": "Anfrage läuft...",
		"Grant Permission": "Berechtigung erteilen",
		Sessions: "Sitzungen",
		"Load a previous conversation": "Frühere Konversation laden",
		"No sessions yet": "Noch keine Sitzungen",
		"Delete this session?": "Diese Sitzung löschen?",
		Today: "Heute",
		Yesterday: "Gestern",
		"{days} days ago": "vor {days} Tagen",
		messages: "Nachrichten",
		tokens: "Tokens",
		Delete: "Löschen",
		"Drop files here": "Dateien hier ablegen",
		"Command failed:": "Befehl fehlgeschlagen:",
	},
};

setTranslations(translations);

export * from "@mariozechner/mini-lit/dist/i18n.js";
