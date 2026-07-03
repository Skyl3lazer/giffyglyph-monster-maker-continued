// Publishes the current release to the Foundry VTT package release API.
// Reads the already-stamped module.json and requires these environment variables:
//   FOUNDRY_PACKAGE_RELEASE_TOKEN, GITHUB_REPOSITORY, GITHUB_REF_NAME
import fs from "node:fs";

const token = process.env.FOUNDRY_PACKAGE_RELEASE_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;

if (!token) {
	console.error("Missing FOUNDRY_PACKAGE_RELEASE_TOKEN secret; cannot publish to Foundry.");
	process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("module.json", "utf8"));
const compat = pkg.compatibility ?? {};
// The API requires a manifest that points at THIS release, not the rolling `latest` URL.
const manifest = `https://github.com/${repo}/releases/download/${tag}/module.json`;

const payload = {
	id: pkg.id,
	release: {
		version: pkg.version,
		manifest,
		notes: `https://github.com/${repo}/releases/tag/${tag}`,
		compatibility: {
			minimum: compat.minimum,
			verified: compat.verified,
			...(compat.maximum ? { maximum: compat.maximum } : {})
		}
	}
};

// Foundry fetches the manifest server-side to validate, so wait for the freshly
// uploaded release asset to become reachable before we call the API.
async function manifestReady(url, attempts = 10) {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(url, { redirect: "follow" });
			if (res.ok) return true;
		} catch { /* not ready yet */ }
		await new Promise((r) => setTimeout(r, 3000));
	}
	return false;
}

if (!(await manifestReady(manifest))) {
	console.error(`Release manifest not reachable after retries: ${manifest}`);
	process.exit(1);
}

const res = await fetch("https://foundryvtt.com/_api/packages/release_version/", {
	method: "POST",
	headers: { "Content-Type": "application/json", "Authorization": token },
	body: JSON.stringify(payload)
});

const body = await res.text();
console.log(`Foundry release API responded ${res.status}`);
console.log(body);

if (!res.ok) {
	console.error("Foundry package release failed.");
	process.exit(1);
}
console.log(`Published ${pkg.id} v${pkg.version} to Foundry.`);
