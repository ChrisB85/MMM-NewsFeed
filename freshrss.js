/* Magic Mirror
 * FreshRSS fetcher
 *
 * Reads a FreshRSS category or feed through the Google Reader API and marks
 * entries as read. Same interface as fetcher.js, so node_helper treats both alike.
 */

var READ = "user/-/state/com.google/read";

/* client(options)
 * Thin Google Reader API client.
 *
 * attribute options object - {url, user, apiPassword}; url is the FreshRSS address.
 */
var client = function (options) {
	var api = options.url.replace(/\/+$/, "") + "/api/greader.php";
	var auth = null;
	var token = null;

	var login = async function () {
		var res = await fetch(api + "/accounts/ClientLogin", {
			method: "POST",
			body: new URLSearchParams({ Email: options.user, Passwd: options.apiPassword })
		});
		var match = res.ok && /^Auth=(.+)$/m.exec(await res.text());
		if (!match) {
			throw new Error("FreshRSS login failed for user " + options.user + " (HTTP " + res.status + ")");
		}
		auth = match[1].trim();
		token = null;
	};

	// One retry after a fresh login: FreshRSS drops the session when the API password changes.
	var request = async function (path, init) {
		for (var attempt = 0; attempt < 2; attempt++) {
			if (!auth) {
				await login();
			}
			var res = await fetch(api + path, Object.assign({}, init, {
				headers: { Authorization: "GoogleLogin auth=" + auth }
			}));
			if (res.status === 401 && attempt === 0) {
				auth = null;
				continue;
			}
			if (!res.ok) {
				throw new Error("FreshRSS " + path.split("?")[0] + ": HTTP " + res.status);
			}
			return res;
		}
	};

	return {
		subscriptions: async function () {
			var res = await request("/reader/api/0/subscription/list?output=json");
			return (await res.json()).subscriptions || [];
		},
		stream: async function (streamId, query) {
			var res = await request("/reader/api/0/stream/contents/" + streamId + "?" + new URLSearchParams(query));
			return (await res.json()).items || [];
		},
		markRead: async function (id) {
			if (!token) {
				token = (await (await request("/reader/api/0/token")).text()).trim();
			}
			await request("/reader/api/0/edit-tag", {
				method: "POST",
				body: new URLSearchParams({ i: id, a: READ, T: token })
			});
		}
	};
};

/* streamId(subscriptions, category, feed)
 * Stream of the feed named `feed` (inside `category` when given), or of the whole category.
 */
var streamId = function (subscriptions, category, feed) {
	if (!feed) {
		return "user/-/label/" + encodeURIComponent(category);
	}
	var found = subscriptions.find(function (s) {
		return s.title === feed && (!category || (s.categories || []).some(function (c) {
			return c.label === category;
		}));
	});
	if (!found) {
		throw new Error("FreshRSS feed not found: " + (category ? category + " / " : "") + feed);
	}
	return found.id;
};

/* toItem(entry)
 * Google Reader entry -> item in the shape fetcher.js produces.
 */
var toItem = function (entry) {
	var content = (entry.summary && entry.summary.content) || (entry.content && entry.content.content) || "";
	return {
		title: entry.title,
		description: content.replace(/(<([^>]+)>)/ig, ""),
		content: content,
		pubdate: new Date(entry.published * 1000).toISOString(),
		url: ((entry.alternate || [])[0] || {}).href || "",
		freshrssId: entry.id
	};
};

/* FreshRSSFetcher
 *
 * attribute key string - Feed key the module uses to match items to this feed.
 * attribute feed object - Feed config: {url, freshrss: {user, apiPassword, category, feed, unreadOnly, maxItems}}.
 *   unreadOnly (default false) skips entries already read in FreshRSS.
 * attribute reloadInterval number - Reload interval in milliseconds.
 */
var FreshRSSFetcher = function (key, feed, reloadInterval) {
	var self = this;
	var options = feed.freshrss;
	var api = client({ url: feed.url, user: options.user, apiPassword: options.apiPassword });
	var stream = null;
	var reloadTimer = null;
	var items = [];

	var fetchFailedCallback = function () {};
	var itemsReceivedCallback = function () {};

	var fetchNews = async function () {
		clearTimeout(reloadTimer);
		try {
			stream = stream || streamId(await api.subscriptions(), options.category, options.feed);
			var query = { output: "json", n: options.maxItems || 50 };
			if (options.unreadOnly) {
				query.xt = READ;
			}
			items = (await api.stream(stream, query)).map(toItem);
			itemsReceivedCallback(self);
		} catch (error) {
			stream = null; // a renamed or re-subscribed feed is found again on the next try
			fetchFailedCallback(self, String(error));
		}
		reloadTimer = setTimeout(fetchNews, reloadInterval);
	};

	this.setReloadInterval = function (interval) {
		if (interval > 1000 && interval < reloadInterval) {
			reloadInterval = interval;
		}
	};

	this.startFetch = function () {
		fetchNews();
	};

	// Unlike fetcher.js an empty list is broadcast too: the last unread entry was read.
	this.broadcastItems = function () {
		itemsReceivedCallback(self);
	};

	this.markRead = function (id) {
		return api.markRead(id);
	};

	this.onReceive = function (callback) {
		itemsReceivedCallback = callback;
	};

	this.onError = function (callback) {
		fetchFailedCallback = callback;
	};

	this.url = function () {
		return key;
	};

	this.items = function () {
		return items;
	};
};

module.exports = { FreshRSSFetcher: FreshRSSFetcher, client: client, streamId: streamId, toItem: toItem };
