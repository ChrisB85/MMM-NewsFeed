// Run: node --test test/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const { FreshRSSFetcher, streamId, toItem } = require("../freshrss.js");

// Pending reload timers must not keep the test process alive.
const setTimer = global.setTimeout;
global.setTimeout = (...args) => setTimer(...args).unref();

// Fake FreshRSS: records requests, answers by path.
function fakeFreshRSS ({ expireFirstAuth = false } = {}) {
	const calls = [];
	let logins = 0;
	global.fetch = async (url, init = {}) => {
		const path = url.replace("http://rss/api/greader.php", "");
		const body = init.body ? Object.fromEntries(init.body) : null;
		calls.push({ path, method: init.method || "GET", body, auth: init.headers && init.headers.Authorization });
		const reply = (status, text) => ({ ok: status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
		if (path === "/accounts/ClientLogin") {
			logins++;
			return body.Passwd === "secret" ? reply(200, "SID=x\nLSID=null\nAuth=user/abc" + logins + "\n") : reply(401, "Unauthorized");
		}
		if (expireFirstAuth && init.headers.Authorization === "GoogleLogin auth=user/abc1") {
			return reply(401, "Unauthorized");
		}
		if (path.startsWith("/reader/api/0/subscription/list")) {
			return reply(200, JSON.stringify({ subscriptions: [
				{ id: "feed/1", title: "Wiadomości", categories: [{ id: "user/-/label/Inne", label: "Inne" }] },
				{ id: "feed/83", title: "Wiadomości", categories: [{ id: "user/-/label/Podsumowania", label: "Podsumowania" }] }
			] }));
		}
		if (path.startsWith("/reader/api/0/stream/contents/")) {
			return reply(200, JSON.stringify({ items: [{
				id: "tag:google.com,2005:reader/item/0000000000000001",
				title: "Temat",
				published: 1760400000,
				alternate: [{ href: "http://digest/t/1" }],
				summary: { content: "<p>Co <b>nowego</b></p>" }
			}] }));
		}
		if (path === "/reader/api/0/token") {
			return reply(200, "tok123\n");
		}
		if (path === "/reader/api/0/edit-tag") {
			return reply(200, "OK");
		}
		return reply(404, "");
	};
	return calls;
}

function fetcher (freshrss) {
	return new Promise((resolve, reject) => {
		const f = new FreshRSSFetcher("key", { url: "http://rss/", freshrss: Object.assign({ user: "u", apiPassword: "secret" }, freshrss) }, 60 * 60 * 1000);
		f.onReceive(() => resolve(f));
		f.onError((_, error) => reject(new Error(error)));
		f.startFetch();
	});
}

test("feed name is looked up inside its category, category alone is a label stream", () => {
	const subs = [
		{ id: "feed/1", title: "Wiadomości", categories: [{ label: "Inne" }] },
		{ id: "feed/83", title: "Wiadomości", categories: [{ label: "Podsumowania" }] }
	];
	assert.strictEqual(streamId(subs, "Podsumowania", "Wiadomości"), "feed/83");
	assert.strictEqual(streamId(subs, "Kultura i rozrywka"), "user/-/label/Kultura%20i%20rozrywka");
	assert.throws(() => streamId(subs, "Podsumowania", "Brak"), /not found/);
});

test("entry becomes an item with plain description and FreshRSS id", () => {
	const item = toItem({ id: "tag:x/1", title: "T", published: 1760400000, alternate: [{ href: "http://a" }], summary: { content: "<p>a <b>b</b></p>" } });
	assert.deepStrictEqual(item, { title: "T", description: "a b", content: "<p>a <b>b</b></p>", pubdate: "2025-10-14T00:00:00.000Z", url: "http://a", freshrssId: "tag:x/1" });
});

test("unreadOnly excludes read entries, default shows all", async () => {
	let calls = fakeFreshRSS();
	let f = await fetcher({ category: "Podsumowania", feed: "Wiadomości", unreadOnly: true });
	let stream = calls.find((c) => c.path.startsWith("/reader/api/0/stream/contents/"));
	assert.match(stream.path, /^\/reader\/api\/0\/stream\/contents\/feed\/83\?/);
	assert.strictEqual(new URLSearchParams(stream.path.split("?")[1]).get("xt"), "user/-/state/com.google/read");
	assert.strictEqual(f.items()[0].freshrssId, "tag:google.com,2005:reader/item/0000000000000001");

	calls = fakeFreshRSS();
	await fetcher({ category: "Podsumowania", feed: "Wiadomości" });
	stream = calls.find((c) => c.path.startsWith("/reader/api/0/stream/contents/"));
	assert.strictEqual(new URLSearchParams(stream.path.split("?")[1]).get("xt"), null);
});

test("markRead sends the read tag with a write token", async () => {
	const calls = fakeFreshRSS();
	const f = await fetcher({ category: "Podsumowania" });
	await f.markRead("tag:google.com,2005:reader/item/0000000000000001");
	const edit = calls.find((c) => c.path === "/reader/api/0/edit-tag");
	assert.deepStrictEqual(edit.body, { i: "tag:google.com,2005:reader/item/0000000000000001", a: "user/-/state/com.google/read", T: "tok123" });
	assert.strictEqual(edit.auth, "GoogleLogin auth=user/abc1");
});

test("expired session logs in again once", async () => {
	const calls = fakeFreshRSS({ expireFirstAuth: true });
	const f = await fetcher({ category: "Podsumowania" });
	assert.strictEqual(f.items().length, 1);
	assert.strictEqual(calls.filter((c) => c.path === "/accounts/ClientLogin").length, 2);
});

test("wrong API password is reported, not thrown", async () => {
	fakeFreshRSS();
	await assert.rejects(fetcher({ apiPassword: "bad", category: "Podsumowania" }), /login failed/);
});
