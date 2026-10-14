# Module: News Feed
The `newsfeed ` module is one of the default modules of the MagicMirror.
This module displays news headlines based on an RSS feed. Scrolling through news headlines happens time-based (````updateInterval````), but can also be controlled by sending news feed specific notifications to the module.

For configuration options, please check the [MagicMirror² documentation](https://docs.magicmirror.builders/modules/newsfeed.html).

## FreshRSS feeds

A feed with a `freshrss` block is read from FreshRSS through its Google Reader API
(enable the API and set an API password in FreshRSS: Settings → Profile).

```js
{
    title: "Wiadomości",
    url: "http://freshrss.local:8081",          // FreshRSS address
    freshrss: {
        user: "login",
        apiPassword: "${SECRET_FRESHRSS_API_PASSWORD}", // from config/config.env
        category: "Podsumowania",               // category name
        feed: "Wiadomości",                     // optional: one feed of the category
        unreadOnly: true,                       // default false: all entries
        markReadOnOpen: true,                   // default false: opening the full article marks it as read
        maxItems: 50,                           // default 50
    },
},
```

In the full article view `ARTICLE_NEXT` / `ARTICLE_PREVIOUS` open the next / previous article
in full; closing it leaves the teaser on the article read last.

Entries come from the account in the block, so each person can have their own module
instance (e.g. shown by face recognition classes) with their own account.

Tests: `node --test test/*.test.js`
