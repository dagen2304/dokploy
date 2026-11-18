import { describe, expect, it } from "vitest";
import fr from "@/lib/i18n/fr.json";
import { translateText } from "@/lib/i18n/runtime";

describe("translateText", () => {
	it("translates whole known strings and keeps surrounding spaces", () => {
		expect(translateText("Create Service")).toBe("Créer un service");
		expect(translateText("  Settings ")).toBe("  Paramètres ");
		expect(translateText("Create\n   Service")).toBe("Créer un service");
	});

	it("leaves technical vocabulary in English", () => {
		expect(translateText("Deploy")).toBeNull();
		expect(translateText("Logs")).toBeNull();
		expect(translateText("Domains")).toBeNull();
	});

	it("never translates part of a string", () => {
		expect(translateText("Create Service now")).toBeNull();
		expect(translateText("my-api-production")).toBeNull();
	});

	it("translates date-fns relative times", () => {
		expect(translateText("about 18 hours ago")).toBe(
			"il y a environ 18 heures",
		);
		expect(translateText("1 day ago")).toBe("il y a 1 jour");
		expect(translateText("3 minutes ago")).toBe("il y a 3 minutes");
		expect(translateText("less than a minute ago")).toBe(
			"il y a moins d'une minute",
		);
		expect(translateText("in 6 days")).toBe("dans 6 jours");
		expect(translateText("over 1 year ago")).toBe("il y a plus de 1 an");
	});

	it("ignores text without letters", () => {
		expect(translateText("3000")).toBeNull();
		expect(translateText("  ")).toBeNull();
	});
});

describe("fr.json", () => {
	it("has no empty or untrimmed entries", () => {
		for (const [en, fr_] of Object.entries(fr as Record<string, string>)) {
			expect(en).toBe(en.trim());
			expect(fr_.trim()).not.toBe("");
			expect(fr_).not.toMatch(/&(gt|lt|amp|quot|nbsp);/);
		}
	});
});
