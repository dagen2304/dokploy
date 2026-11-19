// Gmail and most mail clients do not render SVG, so e-mails use a PNG copy of
// the Olympe logo served from the public fork.
export const EMAIL_LOGO_URL =
	process.env.OLYMPE_EMAIL_LOGO_URL ||
	"https://raw.githubusercontent.com/dagen2304/dokploy/ktc/apps/dokploy/public/olympe-logo.png";
