import fr from "./fr.json";

// Olympe (KTC fork): French interface without touching Dokploy's components.
// Rendered English text is swapped for its translation in the DOM, so
// upstream merges never conflict on UI strings; a string missing from
// fr.json simply stays in English. Only whole, known strings are replaced.

export type Lang = "fr" | "en";

const STORAGE_KEY = "olympe:lang";
const dictionary: Record<string, string> = fr;

// Code, logs, terminals, editors and anything typed by the user stay as is.
const SKIP_SELECTOR = [
	"script",
	"style",
	"pre",
	"code",
	"kbd",
	"textarea",
	"[contenteditable]",
	".cm-editor",
	".xterm",
	".monaco-editor",
	".font-mono",
	"[data-no-translate]",
].join(",");

const ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

export const getLang = (): Lang => {
	try {
		return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "fr";
	} catch {
		return "fr";
	}
};

export const setLang = (lang: Lang) => {
	try {
		localStorage.setItem(STORAGE_KEY, lang);
	} catch {
		// Without storage the choice only lasts until the reload below.
	}
	window.location.reload();
};

const plural = (n: string, one: string, many: string) =>
	n === "1" ? `${n} ${one}` : `${n} ${many}`;

// date-fns formatDistance (English) → French.
const translateDistance = (distance: string): string | null => {
	if (distance === "less than a minute") return "moins d'une minute";
	if (distance === "less than 5 seconds") return "moins de 5 secondes";
	if (distance === "half a minute") return "30 secondes";
	const match =
		/^(about |over |almost |less than )?(\d+) (second|minute|hour|day|week|month|year)s?$/.exec(
			distance,
		);
	if (!match) return null;
	const [, qualifier = "", n = "", unit = ""] = match;
	const units: Record<string, [string, string]> = {
		second: ["seconde", "secondes"],
		minute: ["minute", "minutes"],
		hour: ["heure", "heures"],
		day: ["jour", "jours"],
		week: ["semaine", "semaines"],
		month: ["mois", "mois"],
		year: ["an", "ans"],
	};
	const prefix: Record<string, string> = {
		"about ": "environ ",
		"over ": "plus de ",
		"almost ": "presque ",
		"less than ": "moins de ",
	};
	const [one, many] = units[unit] ?? ["", ""];
	return `${prefix[qualifier] ?? ""}${plural(n, one, many)}`;
};

const translateCore = (text: string): string | null => {
	const exact = dictionary[text];
	if (exact !== undefined) return exact;

	const ago = /^(.+) ago$/.exec(text);
	if (ago?.[1]) {
		const distance = translateDistance(ago[1]);
		if (distance) return `il y a ${distance}`;
	}
	const future = /^in (.+)$/.exec(text);
	if (future?.[1]) {
		const distance = translateDistance(future[1]);
		if (distance) return `dans ${distance}`;
	}
	return null;
};

/** Translates a whole string, keeping its surrounding whitespace. */
export const translateText = (value: string): string | null => {
	const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
	if (!match) return null;
	const [, leading = "", core = "", trailing = ""] = match;
	if (!/[A-Za-z]/.test(core)) return null;
	const normalized = core.replace(/\s+/g, " ");
	const translated = translateCore(normalized);
	return translated === null ? null : `${leading}${translated}${trailing}`;
};

const isSkipped = (element: Element | null) =>
	!!element?.closest(SKIP_SELECTOR);

const translateElementAttributes = (element: Element) => {
	if (isSkipped(element)) return;
	for (const name of ATTRIBUTES) {
		const value = element.getAttribute(name);
		if (!value) continue;
		const translated = translateText(value);
		if (translated !== null && translated !== value) {
			element.setAttribute(name, translated);
		}
	}
};

const translateTextNode = (node: Text) => {
	const value = node.nodeValue;
	if (!value || isSkipped(node.parentElement)) return;
	const translated = translateText(value);
	if (translated !== null && translated !== value) node.nodeValue = translated;
};

export const translateTree = (root: Node) => {
	if (root.nodeType === Node.TEXT_NODE) {
		translateTextNode(root as Text);
		return;
	}
	if (root.nodeType !== Node.ELEMENT_NODE) return;
	const element = root as Element;
	if (isSkipped(element)) return;
	translateElementAttributes(element);
	for (const child of element.querySelectorAll(
		ATTRIBUTES.map((name) => `[${name}]`).join(","),
	)) {
		translateElementAttributes(child);
	}
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		translateTextNode(node as Text);
	}
};

let observer: MutationObserver | null = null;

/** Call once on the client, after hydration. */
export const startTranslation = () => {
	if (observer || typeof window === "undefined") return;
	const lang = getLang();
	document.documentElement.lang = lang;
	if (lang !== "fr") return;

	translateTree(document.body);
	observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "childList") {
				for (const node of record.addedNodes) translateTree(node);
			} else if (record.type === "characterData") {
				translateTextNode(record.target as Text);
			} else if (record.type === "attributes") {
				translateElementAttributes(record.target as Element);
			}
		}
	});
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: [...ATTRIBUTES],
	});
};
