// KTC fork: collects the UI strings of the panel so they can be translated
// in apps/dokploy/lib/i18n/fr.json without touching Dokploy's components.
// Usage: node scripts/i18n/extract.mjs [--missing]
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// The repo's TypeScript 7 ships without the JS compiler API; use the 5.x copy.
const pnpm = path.resolve("node_modules/.pnpm");
const ts5 = fs.readdirSync(pnpm).find((d) => /^typescript@5\./.test(d));
const ts = require(path.join(pnpm, ts5, "node_modules/typescript"));

const ROOTS = ["apps/dokploy/components", "apps/dokploy/pages"];
const ATTRS = new Set([
	"placeholder",
	"title",
	"aria-label",
	"label",
	"description",
	"tooltip",
	"alt",
]);
const CALLS = new Set(["success", "error", "info", "warning", "message"]);

const walk = (dir) =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) return e.name === "proprietary" ? [] : walk(p);
		return p.endsWith(".tsx") ? [p] : [];
	});

// JSX text is rendered with its HTML entities decoded; the DOM is what gets matched.
const ENTITIES = {
	"&gt;": ">",
	"&lt;": "<",
	"&amp;": "&",
	"&quot;": '"',
	"&apos;": "'",
	"&#39;": "'",
	"&nbsp;": "\u00a0",
};
const decode = (s) =>
	s.replace(/&(?:gt|lt|amp|quot|apos|#39|nbsp);/g, (e) => ENTITIES[e]);
const normalize = (s) => decode(s).replace(/\s+/g, " ").trim();
const keep = (s) =>
	/[A-Za-z]{2,}/.test(s) && !/^[a-z0-9._/-]+$/.test(s) && s.length < 400;

const strings = new Map();
const add = (s, file) => {
	const text = normalize(s);
	if (!keep(text)) return;
	if (!strings.has(text)) strings.set(text, new Set());
	strings.get(text).add(file);
};

for (const file of ROOTS.flatMap(walk)) {
	const src = ts.createSourceFile(
		file,
		fs.readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const visit = (node) => {
		if (ts.isJsxText(node)) add(node.getText(), file);
		else if (
			ts.isJsxAttribute(node) &&
			ATTRS.has(node.name.getText()) &&
			node.initializer
		) {
			const init = node.initializer;
			if (ts.isStringLiteral(init)) add(init.text, file);
			else if (
				ts.isJsxExpression(init) &&
				init.expression &&
				(ts.isStringLiteral(init.expression) ||
					ts.isNoSubstitutionTemplateLiteral(init.expression))
			)
				add(init.expression.text, file);
		} else if (
			ts.isJsxExpression(node) &&
			node.expression &&
			ts.isStringLiteral(node.expression) &&
			ts.isJsxElement(node.parent)
		) {
			add(node.expression.text, file);
		} else if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.expression.getText() === "toast" &&
			CALLS.has(node.expression.name.getText())
		) {
			const arg = node.arguments[0];
			if (
				arg &&
				(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
			)
				add(arg.text, file);
		} else if (
			ts.isPropertyAssignment(node) &&
			["message", "title", "description", "label"].includes(
				node.name.getText(),
			) &&
			(ts.isStringLiteral(node.initializer) ||
				ts.isNoSubstitutionTemplateLiteral(node.initializer))
		) {
			add(node.initializer.text, file);
		}
		ts.forEachChild(node, visit);
	};
	visit(src);
}

const out = [...strings.entries()].map(([text, files]) => ({
	text,
	files: [...files].map((f) => path.relative("apps/dokploy", f)),
}));
if (process.argv.includes("--missing")) {
	const fr = JSON.parse(
		fs.readFileSync("apps/dokploy/lib/i18n/fr.json", "utf8"),
	);
	const missing = out.filter((s) => !(s.text in fr));
	console.log(
		`${out.length - missing.length}/${out.length} strings translated (${Math.round(((out.length - missing.length) / out.length) * 100)}%)`,
	);
	fs.writeFileSync(
		"scripts/i18n/missing.json",
		JSON.stringify(missing, null, 1),
	);
} else {
	fs.writeFileSync("scripts/i18n/strings.json", JSON.stringify(out, null, 1));
	console.log(`${out.length} unique strings`);
}
