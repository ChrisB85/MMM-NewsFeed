// Run: node --test test/*.test.js
// Loads the browser side of the module with MagicMirror stubbed out.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadModule () {
	let definition;
	const context = {
		Module: { register: (name, def) => { definition = def; } },
		Log: { info () {} },
		window: { scrollTo () {} },
		setTimeout: () => 0,
		clearTimeout () {},
		clearInterval () {}
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../MMM-NewsFeed.js"), "utf8"), context);
	const feed = { title: "Wiadomości", url: "http://rss", freshrss: { category: "Podsumowania", feed: "Wiadomości", markReadOnOpen: true } };
	const module = Object.assign(Object.create(definition), {
		name: "MMM-NewsFeed",
		config: Object.assign({}, definition.defaults, { feeds: [feed] }),
		newsItems: [],
		activeItem: 0,
		sent: [],
		renders: 0,
		sendSocketNotification (notification, payload) { this.sent.push({ notification, payload }); },
		sendNotification () {},
		updateDom () { this.renders++; }
	});
	return { module, key: module.feedKey(feed) };
}

const item = (n) => ({ title: "T" + n, description: "", content: "", pubdate: new Date(2026, 9, 14, 12, 60 - n).toISOString(), url: "http://a/" + n, freshrssId: "id" + n });

test("in the full article view the gestures open the next article in full and mark it read", () => {
	const { module, key } = loadModule();
	module.generateFeed({ [key]: [item(1), item(2), item(3)] });
	module.config.showFullArticle = true;

	module.notificationReceived("ARTICLE_NEXT");
	assert.strictEqual(module.activeItem, 1);
	assert.strictEqual(module.config.showFullArticle, true);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(module.sent.at(-1))), { notification: "MARK_READ", payload: { key, id: "id2" } });

	module.notificationReceived("ARTICLE_PREVIOUS");
	module.notificationReceived("ARTICLE_PREVIOUS");
	assert.strictEqual(module.activeItem, 2, "wraps around to the last article");
	assert.strictEqual(module.config.showFullArticle, true);
});

test("a reload keeps the teaser on the article that was shown", () => {
	const { module, key } = loadModule();
	module.generateFeed({ [key]: [item(1), item(2), item(3)] });
	module.activeItem = 2;
	module.generateFeed({ [key]: [item(0), item(1), item(2), item(3)] });
	assert.strictEqual(module.newsItems[module.activeItem].freshrssId, "id3");
});

test("an open article that was read stays open after an unread-only reload", () => {
	const { module, key } = loadModule();
	module.generateFeed({ [key]: [item(1), item(2), item(3)] });
	module.activeItem = 1;
	module.config.showFullArticle = true;
	module.generateFeed({ [key]: [item(1), item(3)] });
	assert.strictEqual(module.newsItems[module.activeItem].freshrssId, "id2");

	module.notificationReceived("ARTICLE_NEXT");
	assert.strictEqual(module.newsItems[module.activeItem].freshrssId, "id3");
});
