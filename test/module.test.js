// Run: node --test test/*.test.js
// Loads the browser side of the module with MagicMirror stubbed out.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Bottom bar whose copy holds an article sheet; the last sheet is kept for assertions.
let sheet;
function bar () {
	return {
		cloneNode: () => ({
			querySelectorAll: () => [],
			querySelector: () => (sheet = { style: {}, children: [{ style: {} }], getBoundingClientRect () {} }),
			remove () {}
		}),
		after () {},
		style: {}
	};
}

function element () {
	return {
		children: [],
		style: { setProperty (name, value) { this[name] = value; } },
		classList: { add () {} },
		appendChild (child) { this.children.push(child); }
	};
}

function loadModule () {
	let definition;
	const context = {
		Module: { register: (name, def) => { definition = def; } },
		Log: { info () {} },
		window: { scrollTo () {}, scrollY: 0 },
		document: { getElementsByClassName: () => [bar()], createElement: element },
		setTimeout: () => 0,
		clearTimeout () {},
		clearInterval () {},
		setInterval: () => 0
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../MMM-NewsFeed.js"), "utf8"), context);
	const feed = { title: "Wiadomości", url: "http://rss", freshrss: { category: "Podsumowania", feed: "Wiadomości", markReadOnOpen: true } };
	const module = Object.assign(Object.create(definition), {
		name: "MMM-NewsFeed",
		config: Object.assign({}, definition.defaults, { feeds: [feed] }),
		newsItems: [],
		loggedInUsers: [],
		lastFeeds: {},
		activeItem: 0,
		sent: [],
		renders: 0,
		sendSocketNotification (notification, payload) { this.sent.push({ notification, payload }); },
		sendNotification () {},
		translate: (key) => key,
		hide () {},
		updateDom (speed) { this.renders++; this.lastSpeed = speed; }
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
	assert.strictEqual(module.slideFrom, "right", "next article comes in from the right");
	assert.match(sheet.style.transform, /^translate\(-100vw/, "old article leaves to the left");
	assert.strictEqual(sheet.style.opacity, undefined, "the leaving sheet stays opaque");
	assert.strictEqual(sheet.children[0].style.opacity, "0", "only its text fades");

	module.notificationReceived("ARTICLE_PREVIOUS");
	module.notificationReceived("ARTICLE_PREVIOUS");
	assert.strictEqual(module.activeItem, 2, "wraps around to the last article");
	assert.strictEqual(module.slideFrom, "left");
	assert.match(sheet.style.transform, /^translate\(100vw/);
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

test("articleImageMaxHeight caps images in the full article, unset leaves them alone", () => {
	const { module, key } = loadModule();
	module.generateFeed({ [key]: [item(1)] });
	module.config.contentAsArticle = true;
	module.config.showFullArticle = true;
	const article = (dom) => dom.children[0].children.find((c) => /article-content/.test(c.className));

	assert.strictEqual(article(module.getDom()).style["--image-max-height"], undefined);
	module.config.articleImageMaxHeight = "30vh";
	assert.strictEqual(article(module.getDom()).style["--image-max-height"], "30vh");
});

test("articleCutMarkers drop the trailing block from the last marker, no marker leaves the article whole", () => {
	const { module } = loadModule();
	assert.strictEqual(module.cutArticle("<p>a</p><p>Src: x</p>"), "<p>a</p><p>Src: x</p>", "no markers configured");
	module.config.articleCutMarkers = ["<p>Srcs:</p>", "<p>Src: "];
	assert.strictEqual(module.cutArticle("<p>Src: photo</p><p>a</p><p>Src: <a>x</a></p>"), "<p>Src: photo</p><p>a</p>", "only the last occurrence");
	assert.strictEqual(module.cutArticle("<p>a</p><p>Srcs:</p><ul><li>x</li></ul>"), "<p>a</p>");
	assert.strictEqual(module.cutArticle("<p>a</p>"), "<p>a</p>");
});

test("an empty feed says so with showNoNewsMessage, otherwise it keeps the loading text", () => {
	const { module, key } = loadModule();
	module.generateFeed({ [key]: [] });
	module.loaded = true;
	assert.strictEqual(module.getDom().innerHTML, "LOADING");
	module.config.showNoNewsMessage = true;
	assert.strictEqual(module.getDom().innerHTML, "NO_NEWS");
	assert.match(module.getDom().className, /newsfeed-container/, "same bar height as with teasers");
});

test("a logged in user with userFeeds gets their feeds, everyone else the default ones", () => {
	const { module, key } = loadModule();
	const mine = { title: "Moje", url: "http://rss", freshrss: { user: "me", category: "Podsumowania", feed: "Wiadomości", unreadOnly: true, markReadOnOpen: true } };
	module.config.userFeeds = { Me: [mine] };
	const mineKey = module.feedKey(mine);
	assert.notStrictEqual(mineKey, key, "same stream read unread-only gets its own fetcher");

	const feeds = { [key]: [item(1), item(2)], [mineKey]: [item(2)] };
	module.socketNotificationReceived("NEWS_ITEMS", feeds);
	assert.strictEqual(module.newsItems.map((i) => i.freshrssId).join(), ["id1", "id2"].join());

	module.notificationReceived("USERS_LOGIN", ["Other"]);
	assert.strictEqual(module.newsItems.length, 2, "a user without userFeeds sees the default feeds");
	module.notificationReceived("USERS_LOGIN", ["Me"]);
	assert.strictEqual(module.newsItems.map((i) => i.freshrssId).join(), ["id2"].join());
	assert.strictEqual(module.newsItems[0].feedKey, mineKey);

	module.notificationReceived("USERS_LOGOUT_MODULES", "Me");
	assert.strictEqual(module.newsItems.length, 2);

	module.notificationReceived("LOGGED_IN_USERS", ["Me"]);
	assert.strictEqual(module.newsItems.length, 1, "picks up a user logged in before a restart");
});

test("every feed, default and per user, is registered with the node helper", () => {
	const { module } = loadModule();
	module.config.userFeeds = { Me: [{ url: "http://rss", freshrss: { user: "me", category: "C", unreadOnly: true } }] };
	module.registerFeeds();
	assert.strictEqual(module.sent.filter((n) => n.notification === "ADD_FEED").length, 2);
});

test("a login while an article is open waits until it closes, then the article fades out over the new list", () => {
	const { module, key } = loadModule();
	const mine = { title: "Moje", url: "http://rss", freshrss: { user: "me", category: "Podsumowania", feed: "Wiadomości", unreadOnly: true } };
	module.config.userFeeds = { Me: [mine] };
	module.socketNotificationReceived("NEWS_ITEMS", { [key]: [item(1), item(2)], [module.feedKey(mine)]: [] });

	module.config.showFullArticle = true;
	module.notificationReceived("USERS_LOGIN", ["Me"]);
	assert.strictEqual(module.newsItems.length, 2, "the open article and its list stay");
	assert.strictEqual(module.config.showFullArticle, true);

	module.notificationReceived("ARTICLE_LESS_DETAILS");
	assert.strictEqual(module.newsItems.length, 0, "switched once closed");
	assert.strictEqual(sheet.style.opacity, "0", "the closing article fades out");
});

test("a login with no article open fades the list out and in", () => {
	const { module, key } = loadModule();
	module.config.userFeeds = { Me: [{ url: "http://rss", freshrss: { user: "me", category: "C", unreadOnly: true } }] };
	module.socketNotificationReceived("NEWS_ITEMS", { [key]: [item(1)] });
	module.notificationReceived("USERS_LOGIN", ["Me"]);
	assert.strictEqual(module.lastSpeed, module.config.animationSpeed);
	assert.ok(module.lastSpeed > 0);
});

test("scrolling an empty list leaves the no news text alone", () => {
	const { module, key } = loadModule();
	module.socketNotificationReceived("NEWS_ITEMS", { [key]: [] });
	const renders = module.renders;
	module.notificationReceived("ARTICLE_NEXT");
	module.notificationReceived("ARTICLE_PREVIOUS");
	assert.strictEqual(module.renders, renders);
	assert.ok(!module.animationDirection, "no carousel started");
});
