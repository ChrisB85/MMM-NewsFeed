/* global Module */

/* Magic Mirror
 * Module: MMM-NewsFeed
 *
 * By Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 */

Module.register("MMM-NewsFeed", {
    // Default module config.
    defaults: {
        feeds: [
            {
                title: "New York Times",
                url: "http://www.nytimes.com/services/xml/rss/nyt/HomePage.xml",
                encoding: "UTF-8", //ISO-8859-1
            },
        ],
        showSourceTitle: true,
        showPublishDate: true,
        broadcastNewsFeeds: true,
        broadcastNewsUpdates: true,
        showDescription: false,
        wrapTitle: true,
        wrapDescription: true,
        truncDescription: true,
        lengthDescription: 400,
        hideLoading: false,
        reloadInterval: 5 * 60 * 1000, // every 5 minutes
        updateInterval: 10 * 1000,
        animationSpeed: 2.5 * 1000,
        maxNewsItems: 0, // 0 for unlimited
        ignoreOldItems: false,
        ignoreOlderThan: 24 * 60 * 60 * 1000, // 1 day
        removeStartTags: "",
        removeEndTags: "",
        startTags: [],
        endTags: [],
        prohibitedWords: [],
        scrollLength: 500,
        logFeedWarnings: false,
        contentAsArticle: false,
        fullArticleTimeout: 60 * 1000 // 1 minute timeout for full article
    },

    // Define required scripts.
    getScripts: function () {
        return ["moment.js"];
    },

    // Define required translations.
    getTranslations: function () {
        return {
            en: "translations/en.json",
            de: "translations/de.json",
            es: "translations/es.json",
            fr: "translations/fr.json",
            pl: "translations/pl.json"
        };
    },

    // Define start sequence.
    start: function () {
        Log.info("Starting module: " + this.name);

        // Set locale.
        moment.locale(config.language);

        this.newsItems = [];
        this.loaded = false;
        this.activeItem = 0;
        this.scrollPosition = 0;
        this.animationDirection = null;
        this.gestureInProgress = false;
        this.gestureTimeout = null;
        this.timer = null;
        this.fullArticlePaused = false;
        this.articleTimeout = null;
        this.articleOpeningInProgress = false;
        this.articleOpeningTimeout = null;

        this.registerFeeds();

        this.isShowingDescription = this.config.showDescription;
        
        // Add keyboard support for testing
        this.addKeyboardSupport();
    },

    // Override socket notification handler.
    socketNotificationReceived: function (notification, payload) {
        if (notification === "NEWS_ITEMS") {
            this.generateFeed(payload);

            if (!this.loaded) {
                this.scheduleUpdateInterval();
            }

            this.loaded = true;
        }
    },

    // Override dom generator.
    getDom: function () {
        var wrapper = document.createElement("div");
        wrapper.className = "newsfeed-container";

        if (this.config.feedUrl) {
            wrapper.className = "small bright";
            wrapper.innerHTML = this.translate("configuration_changed");
            return wrapper;
        }

        if (this.activeItem >= this.newsItems.length) {
            this.activeItem = 0;
        }


        if (this.newsItems.length > 0) {
            var content = document.createElement("div");
            content.className = "newsfeed-content";
            if (this.animationDirection) {
                content.className += " " + this.animationDirection;
            }
            // this.config.showFullArticle is a run-time configuration, triggered by optional notifications
            if (
                !this.config.showFullArticle &&
                (this.config.showSourceTitle || this.config.showPublishDate)
            ) {
                var sourceAndTimestamp = document.createElement("div");
                sourceAndTimestamp.className =
                    "newsfeed-source light small dimmed";

                if (
                    this.config.showSourceTitle &&
                    this.newsItems[this.activeItem].sourceTitle !== ""
                ) {
                    sourceAndTimestamp.innerHTML = this.newsItems[
                        this.activeItem
                    ].sourceTitle;
                }
                if (
                    this.config.showSourceTitle &&
                    this.newsItems[this.activeItem].sourceTitle !== "" &&
                    this.config.showPublishDate
                ) {
                    sourceAndTimestamp.innerHTML += ", ";
                }
                if (this.config.showPublishDate) {
                    sourceAndTimestamp.innerHTML += moment(
                        new Date(this.newsItems[this.activeItem].pubdate)
                    ).fromNow();
                }
                if (
                    (this.config.showSourceTitle &&
                        this.newsItems[this.activeItem].sourceTitle !== "") ||
                    this.config.showPublishDate
                ) {
                    sourceAndTimestamp.innerHTML += ":";
                }

                content.appendChild(sourceAndTimestamp);
            }

            //Remove selected tags from the beginning of rss feed items (title or description)

            if (
                this.config.removeStartTags === "title" ||
                this.config.removeStartTags === "both"
            ) {
                for (f = 0; f < this.config.startTags.length; f++) {
                    if (
                        this.newsItems[this.activeItem].title.slice(
                            0,
                            this.config.startTags[f].length
                        ) === this.config.startTags[f]
                    ) {
                        this.newsItems[this.activeItem].title = this.newsItems[
                            this.activeItem
                        ].title.slice(
                            this.config.startTags[f].length,
                            this.newsItems[this.activeItem].title.length
                        );
                    }
                }
            }

            if (
                this.config.removeStartTags === "description" ||
                this.config.removeStartTags === "both"
            ) {
                if (this.isShowingDescription) {
                    for (f = 0; f < this.config.startTags.length; f++) {
                        if (
                            this.newsItems[this.activeItem].description.slice(
                                0,
                                this.config.startTags[f].length
                            ) === this.config.startTags[f]
                        ) {
                            this.newsItems[
                                this.activeItem
                            ].description = this.newsItems[
                                this.activeItem
                            ].description.slice(
                                this.config.startTags[f].length,
                                this.newsItems[this.activeItem].description
                                    .length
                            );
                        }
                    }
                }
            }

            //Remove selected tags from the end of rss feed items (title or description)

            if (this.config.removeEndTags) {
                for (f = 0; f < this.config.endTags.length; f++) {
                    if (
                        this.newsItems[this.activeItem].title.slice(
                            -this.config.endTags[f].length
                        ) === this.config.endTags[f]
                    ) {
                        this.newsItems[this.activeItem].title = this.newsItems[
                            this.activeItem
                        ].title.slice(0, -this.config.endTags[f].length);
                    }
                }

                if (this.isShowingDescription) {
                    for (f = 0; f < this.config.endTags.length; f++) {
                        if (
                            this.newsItems[this.activeItem].description.slice(
                                -this.config.endTags[f].length
                            ) === this.config.endTags[f]
                        ) {
                            this.newsItems[
                                this.activeItem
                            ].description = this.newsItems[
                                this.activeItem
                            ].description.slice(
                                0,
                                -this.config.endTags[f].length
                            );
                        }
                    }
                }
            }

            if (!this.config.showFullArticle) {
                var title = document.createElement("div");
                title.className =
                    "newsfeed-title bright medium light" +
                    (!this.config.wrapTitle ? " no-wrap" : "");
                title.innerHTML = this.newsItems[this.activeItem].title;
                content.appendChild(title);
            }

            if (this.isShowingDescription) {
                var description = document.createElement("div");
                description.className =
                    "newsfeed-desc small light" +
                    (!this.config.wrapDescription ? " no-wrap" : "");
                var txtDesc = this.newsItems[this.activeItem].description;
                description.innerHTML = this.config.truncDescription
                    ? txtDesc.length > this.config.lengthDescription
                        ? txtDesc.substring(0, this.config.lengthDescription) +
                          "..."
                        : txtDesc
                    : txtDesc;
                content.appendChild(description);
            }

            if (this.config.showFullArticle) {
                if (!this.config.contentAsArticle) {
                    var fullArticle = document.createElement("iframe");
                    fullArticle.className = "full-article-iframe";
                    fullArticle.style.width = "100vw";
                    // very large height value to allow scrolling
                    fullArticle.height = "3000";
                    fullArticle.style.height = "3000";
                    fullArticle.style.top = "0";
                    fullArticle.style.left = "0";
                    fullArticle.style.border = "none";
                    fullArticle.src = this.getActiveItemURL();
                    fullArticle.style.zIndex = 1;
                } else {
                    var fullArticle = document.createElement("div");
                    var rawContent = this.newsItems[this.activeItem].content;
                    console.log(this.getActiveItemURL());
                    // console.log(rawContent);
                    // var content = this.nl2br(rawContent);
                    // content = content.replace(/\./g, ". ");
                    // content = content.replace(/\s\s+/g, " ");
                    fullArticle.innerHTML = rawContent;
                    fullArticle.className =
                        "article-content bright medium light";
                    fullArticle.style.width = "100%";
                    // very large height value to allow scrolling
                    fullArticle.style.height = "3000";
                    fullArticle.style.top = "0";
                    fullArticle.style.left = "0";
                    fullArticle.style.border = "none";
                    fullArticle.style.zIndex = 1;
                }
                content.appendChild(fullArticle);
                
                // Trigger smooth reveal animation after a short delay
                var self = this;
                setTimeout(function() {
                    fullArticle.classList.add("show");
                    // Hide loading overlay when content is ready
                    self.hideLoadingOverlay();
                    // Clear article opening flag and timeout
                    self.articleOpeningInProgress = false;
                    if (self.articleOpeningTimeout) {
                        clearTimeout(self.articleOpeningTimeout);
                        self.articleOpeningTimeout = null;
                    }
                }, 200);
            }

            wrapper.appendChild(content);

            if (this.config.hideLoading) {
                this.show();
            }
        } else {
            if (this.config.hideLoading) {
                this.hide();
            } else {
                wrapper.innerHTML = this.translate("LOADING");
                wrapper.className = "small dimmed";
            }
        }

        return wrapper;
    },

    getActiveItemURL: function () {
        return typeof this.newsItems[this.activeItem].url === "string"
            ? this.newsItems[this.activeItem].url
            : this.newsItems[this.activeItem].url.href;
    },

    /* registerFeeds()
     * registers the feeds to be used by the backend.
     */
    registerFeeds: function () {
        for (var f in this.config.feeds) {
            var feed = this.config.feeds[f];
            this.sendSocketNotification("ADD_FEED", {
                feed: feed,
                config: this.config,
            });
        }
    },

    /* generateFeed()
     * Generate an ordered list of items for this configured module.
     *
     * attribute feeds object - An object with feeds returned by the node helper.
     */
    generateFeed: function (feeds) {
        var newsItems = [];
        for (var feed in feeds) {
            var feedItems = feeds[feed];
            if (this.subscribedToFeed(feed)) {
                for (var i in feedItems) {
                    var item = feedItems[i];
                    item.sourceTitle = this.titleForFeed(feed);
                    if (
                        !(
                            this.config.ignoreOldItems &&
                            Date.now() - new Date(item.pubdate) >
                                this.config.ignoreOlderThan
                        )
                    ) {
                        newsItems.push(item);
                    }
                }
            }
        }
        newsItems.sort(function (a, b) {
            var dateA = new Date(a.pubdate);
            var dateB = new Date(b.pubdate);
            return dateB - dateA;
        });
        if (this.config.maxNewsItems > 0) {
            newsItems = newsItems.slice(0, this.config.maxNewsItems);
        }

        if (this.config.prohibitedWords.length > 0) {
            newsItems = newsItems.filter(function (value) {
                for (var i = 0; i < this.config.prohibitedWords.length; i++) {
                    if (
                        value["title"]
                            .toLowerCase()
                            .indexOf(
                                this.config.prohibitedWords[i].toLowerCase()
                            ) > -1
                    ) {
                        return false;
                    }
                }
                return true;
            }, this);
        }

        // get updated news items and broadcast them
        var updatedItems = [];
        newsItems.forEach((value) => {
            if (this.newsItems.findIndex((value1) => value1 === value) === -1) {
                // Add item to updated items list
                updatedItems.push(value);
            }
        });

        // check if updated items exist, if so and if we should broadcast these updates, then lets do so
        if (this.config.broadcastNewsUpdates && updatedItems.length > 0) {
            this.sendNotification("NEWS_FEED_UPDATE", { items: updatedItems });
        }

        this.newsItems = newsItems;
    },

    /* subscribedToFeed(feedUrl)
     * Check if this module is configured to show this feed.
     *
     * attribute feedUrl string - Url of the feed to check.
     *
     * returns bool
     */
    subscribedToFeed: function (feedUrl) {
        for (var f in this.config.feeds) {
            var feed = this.config.feeds[f];
            if (feed.url === feedUrl) {
                return true;
            }
        }
        return false;
    },

    /* titleForFeed(feedUrl)
     * Returns title for a specific feed Url.
     *
     * attribute feedUrl string - Url of the feed to check.
     *
     * returns string
     */
    titleForFeed: function (feedUrl) {
        for (var f in this.config.feeds) {
            var feed = this.config.feeds[f];
            if (feed.url === feedUrl) {
                return feed.title || "";
            }
        }
        return "";
    },

    /* scheduleUpdateInterval()
     * Schedule visual update.
     */
    scheduleUpdateInterval: function () {
        var self = this;

        // Clear existing timer if any
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        self.updateDom(self.config.animationSpeed);

        // Broadcast NewsFeed if needed
        if (self.config.broadcastNewsFeeds) {
            self.sendNotification("NEWS_FEED", { items: self.newsItems });
        }

        this.timer = setInterval(function () {
            // Skip automatic update if gesture is in progress
            if (self.gestureInProgress) {
                Log.info(self.name + " - Skipping auto scroll due to gesture in progress");
                return;
            }
            
            // Skip automatic update if full article is being displayed
            if (self.config.showFullArticle) {
                Log.info(self.name + " - Skipping auto scroll due to full article being displayed");
                return;
            }
            
            // Skip automatic update if article is being opened
            if (self.articleOpeningInProgress) {
                Log.info(self.name + " - Skipping auto scroll due to article opening in progress");
                return;
            }
            
            self.activeItem++;
            Log.info(self.name + " - Auto scrolling to article #" + self.activeItem);
            self.updateDom(self.config.animationSpeed);

            // Broadcast NewsFeed if needed
            if (self.config.broadcastNewsFeeds) {
                self.sendNotification("NEWS_FEED", { items: self.newsItems });
            }
        }, this.config.updateInterval);
    },

    /* pauseAutoScroll()
     * Pause automatic scrolling during gesture handling
     */
    pauseAutoScroll: function () {
        this.gestureInProgress = true;
        Log.info(this.name + " - Pausing auto scroll due to gesture");
        
        // Clear the timer completely
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        
        // Clear any existing timeout and reset it
        if (this.gestureTimeout) {
            clearTimeout(this.gestureTimeout);
        }
        
        // Set timeout to resume auto scroll after gesture handling
        // This will be reset each time a new gesture is detected
        var self = this;
        this.gestureTimeout = setTimeout(function() {
            Log.info(self.name + " - Auto resuming scroll after 10 seconds of inactivity");
            self.resumeAutoScroll();
        }, 10000); // Resume after 10 seconds of no gestures
    },

    /* resumeAutoScroll()
     * Resume automatic scrolling after gesture handling
     */
    resumeAutoScroll: function () {
        this.gestureInProgress = false;
        Log.info(this.name + " - Resuming auto scroll");
        
        if (this.gestureTimeout) {
            clearTimeout(this.gestureTimeout);
            this.gestureTimeout = null;
        }
        
        // Restart the timer if it's not running and full article is not being displayed
        if (!this.timer && !this.config.showFullArticle) {
            this.scheduleUpdateInterval();
        }
    },

    /* startArticleTimeout()
     * Start timeout for full article - close it after specified time
     */
    startArticleTimeout: function () {
        var self = this;
        
        // Clear existing timeout
        if (this.articleTimeout) {
            clearTimeout(this.articleTimeout);
        }
        
        // Set new timeout
        this.articleTimeout = setTimeout(function() {
            if (self.config.showFullArticle) {
                Log.info(self.name + " - Closing full article due to timeout");
                self.resetDescrOrFullArticleAndTimer();
            }
        }, this.config.fullArticleTimeout);
        
        Log.info(this.name + " - Started article timeout (" + (this.config.fullArticleTimeout / 1000) + " seconds)");
    },

    /* clearArticleTimeout()
     * Clear timeout for full article
     */
    clearArticleTimeout: function () {
        if (this.articleTimeout) {
            clearTimeout(this.articleTimeout);
            this.articleTimeout = null;
            Log.info(this.name + " - Cleared article timeout");
        }
    },

    /* capitalizeFirstLetter(string)
     * Capitalizes the first character of a string.
     *
     * argument string string - Input string.
     *
     * return string - Capitalized output string.
     */
    capitalizeFirstLetter: function (string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

    resetDescrOrFullArticleAndTimer: function () {
        var self = this;
        
        // Clear article opening flag and timeout
        this.articleOpeningInProgress = false;
        if (this.articleOpeningTimeout) {
            clearTimeout(this.articleOpeningTimeout);
            this.articleOpeningTimeout = null;
        }
        
        // Hide loading overlay if it's showing
        this.hideLoadingOverlay();
        
        // If we're currently showing full article, animate the close
        if (this.config.showFullArticle) {
            // Add hide class to full article elements
            var content = document.querySelector('.newsfeed-content');
            if (content) {
                var fullArticle = content.querySelector('.full-article-iframe, .article-content');
                if (fullArticle) {
                    fullArticle.classList.add('hide');
                    // Swap page scroll for an equal transform so nothing moves yet, then the
                    // slide down reveals the dashboard at the top instead of empty page below it.
                    fullArticle.style.transition = "none";
                    fullArticle.style.transform = "translateY(" + (-window.scrollY) + "px)";
                    window.scrollTo(0, 0);
                    fullArticle.getBoundingClientRect(); // commit the jump before re-enabling the transition
                    fullArticle.style.transition = "";
                    fullArticle.style.transform = "translateY(" + window.innerHeight + "px)";
                }
            }

            // Wait for the slide out (0.6s in style.css), then reset and show title/description
            setTimeout(function() {
                self.isShowingDescription = self.config.showDescription;
                self.config.showFullArticle = false;
                self.scrollPosition = 0;
                
                self.resetBottomBar();

                // Resume auto scroll when closing full article
                self.fullArticlePaused = false;
                self.clearArticleTimeout();
                if (!self.timer && !self.gestureInProgress) {
                    self.scheduleUpdateInterval();
                }
                
                // Update DOM without fade-in animation
                self.updateDom(0);
            }, 600);
        } else {
            // Just reset normally if not showing full article
            this.isShowingDescription = this.config.showDescription;
            this.config.showFullArticle = false;
            this.scrollPosition = 0;
            this.resetBottomBar();
            // Resume auto scroll when closing full article
            this.fullArticlePaused = false;
            this.clearArticleTimeout();
            if (!this.timer && !this.gestureInProgress) {
                this.scheduleUpdateInterval();
            }
        }
    },

    // Undo the full article layout: put the bottom bar back in place and scroll the
    // page back to the top. Resetting only scrollPosition leaves the window where the
    // article left it (clamped to the page's overflow), shifting every region up.
    resetBottomBar: function () {
        var bottomBar = document.getElementsByClassName("region bottom bar")[0];
        bottomBar.style.bottom = "0";
        bottomBar.style.top = "inherit";
        window.scrollTo(0, 0);
    },

    smoothScrollTo: function (targetPosition) {
        var self = this;
        var startPosition = window.pageYOffset || document.documentElement.scrollTop;
        var distance = targetPosition - startPosition;
        var duration = 600; // Animation duration in milliseconds
        var startTime = null;

        // Get maximum scroll position
        var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        
        // Ensure scroll position is within bounds
        if (targetPosition < 0) {
            targetPosition = 0;
        } else if (targetPosition > maxScroll) {
            targetPosition = maxScroll;
        }
        
        distance = targetPosition - startPosition;

        function animation(currentTime) {
            if (startTime === null) startTime = currentTime;
            var timeElapsed = currentTime - startTime;
            var progress = Math.min(timeElapsed / duration, 1);
            
            // Use easing function for smooth animation
            var easeInOutCubic = function(t) {
                return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
            };
            
            var easedProgress = easeInOutCubic(progress);
            var currentPosition = startPosition + (distance * easedProgress);
            
            window.scrollTo(0, currentPosition);
            
            if (progress < 1) {
                requestAnimationFrame(animation);
            } else {
                // Update scroll position to exact target
                self.scrollPosition = targetPosition;
            }
        }

        requestAnimationFrame(animation);
    },

    addKeyboardSupport: function () {
        var self = this;
        
        document.addEventListener('keydown', function(event) {
            // Only handle keyboard events when full article is showing
            if (!self.config.showFullArticle) return;
            
            switch(event.key) {
                case 'ArrowUp':
                case 'PageUp':
                    event.preventDefault();
                    self.scrollPosition -= self.config.scrollLength;
                    self.smoothScrollTo(self.scrollPosition);
                    break;
                case 'ArrowDown':
                case 'PageDown':
                    event.preventDefault();
                    self.scrollPosition += self.config.scrollLength;
                    self.smoothScrollTo(self.scrollPosition);
                    break;
                case 'Home':
                    event.preventDefault();
                    self.scrollPosition = 0;
                    self.smoothScrollTo(self.scrollPosition);
                    break;
                case 'End':
                    event.preventDefault();
                    var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
                    self.scrollPosition = maxScroll;
                    self.smoothScrollTo(self.scrollPosition);
                    break;
                case 'Escape':
                    event.preventDefault();
                    self.resetDescrOrFullArticleAndTimer();
                    Log.info(self.name + " - closing full article (ESC key)");
                    break;
            }
        });
    },

    animateArticleChange: function (direction) {
        var self = this;
        var before = this.activeItem;
        
        // Prevent multiple animations at once
        if (this.animationDirection) {
            return;
        }
        
        // Prevent article change if article is being opened
        if (this.articleOpeningInProgress) {
            Log.info(this.name + " - Skipping article change due to article opening in progress");
            return;
        }
        
        // Calculate new active item
        var newActiveItem;
        if (direction === "right") {
            newActiveItem = this.activeItem + 1;
            if (newActiveItem >= this.newsItems.length) {
                newActiveItem = 0;
            }
        } else {
            newActiveItem = this.activeItem - 1;
            if (newActiveItem < 0) {
                newActiveItem = this.newsItems.length - 1;
            }
        }
        
        // Reset description/full article state but don't restart timer yet
        this.isShowingDescription = this.config.showDescription;
        this.config.showFullArticle = false;
        this.scrollPosition = 0;
        
        this.resetBottomBar();

        Log.info(
            this.name +
                " - going from article #" +
                before +
                " to #" +
                newActiveItem +
                " (of " +
                this.newsItems.length +
                ")"
        );
        
        // Create carousel with 3 articles: previous, current, next
        var prevItem = this.activeItem - 1;
        if (prevItem < 0) prevItem = this.newsItems.length - 1;
        
        var nextItem = this.activeItem + 1;
        if (nextItem >= this.newsItems.length) nextItem = 0;
        
        // Set animation direction
        this.animationDirection = "carousel-" + direction;
        
        // Create carousel container
        var container = document.querySelector('.newsfeed-container');
        if (container) {
            // Clear existing content
            container.innerHTML = '';
            
            // Create carousel wrapper
            var carousel = document.createElement('div');
            carousel.className = 'newsfeed-carousel';
            carousel.style.position = 'relative';
            carousel.style.width = '300%';
            carousel.style.height = '100%';
            carousel.style.display = 'flex';
            carousel.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            
            // Create three article containers
            var articles = [
                { item: prevItem, position: 'left' },
                { item: this.activeItem, position: 'center' },
                { item: nextItem, position: 'right' }
            ];
            
            articles.forEach(function(article, index) {
                var articleContainer = document.createElement('div');
                articleContainer.className = 'carousel-article carousel-' + article.position;
                articleContainer.style.width = '33.333%';
                articleContainer.style.height = '100%';
                articleContainer.style.position = 'relative';
                
                // Create content for this article
                var content = self.createContentElement(article.item);
                content.className = 'newsfeed-content';
                articleContainer.appendChild(content);
                
                carousel.appendChild(articleContainer);
            });
            
            container.appendChild(carousel);
            
            // Set initial position (center article visible)
            carousel.style.transform = 'translateX(-33.333%)';
            
            // Start animation
            setTimeout(function() {
                if (direction === "right") {
                    // Move left to show next article
                    carousel.style.transform = 'translateX(-66.666%)';
                } else {
                    // Move right to show previous article
                    carousel.style.transform = 'translateX(0%)';
                }
                
                // After animation, update activeItem and clean up
                setTimeout(function() {
                    self.activeItem = newActiveItem;
                    self.animationDirection = null;
                    
                    // Remove carousel and show normal content
                    container.innerHTML = '';
                    self.updateDom(0);
                }, 400);
            }, 50);
        }
    },

    createContentElement: function (itemIndex) {
        var content = document.createElement("div");
        content.className = "newsfeed-content";
        
        if (this.newsItems.length > 0 && this.newsItems[itemIndex]) {
            var item = this.newsItems[itemIndex];
            
            // Add source and timestamp
            if (this.config.showSourceTitle || this.config.showPublishDate) {
                var sourceAndTimestamp = document.createElement("div");
                sourceAndTimestamp.className = "newsfeed-source light small dimmed";

                if (this.config.showSourceTitle && item.sourceTitle !== "") {
                    sourceAndTimestamp.innerHTML = item.sourceTitle;
                }
                if (this.config.showSourceTitle && item.sourceTitle !== "" && this.config.showPublishDate) {
                    sourceAndTimestamp.innerHTML += ", ";
                }
                if (this.config.showPublishDate) {
                    sourceAndTimestamp.innerHTML += moment(new Date(item.pubdate)).fromNow();
                }
                if ((this.config.showSourceTitle && item.sourceTitle !== "") || this.config.showPublishDate) {
                    sourceAndTimestamp.innerHTML += ":";
                }

                content.appendChild(sourceAndTimestamp);
            }

            // Add title
            var title = document.createElement("div");
            title.className = "newsfeed-title bright medium light" + (!this.config.wrapTitle ? " no-wrap" : "");
            title.innerHTML = item.title;
            content.appendChild(title);

            // Add description if showing
            if (this.isShowingDescription) {
                var description = document.createElement("div");
                description.className = "newsfeed-desc small light" + (!this.config.wrapDescription ? " no-wrap" : "");
                var txtDesc = item.description;
                description.innerHTML = this.config.truncDescription
                    ? txtDesc.length > this.config.lengthDescription
                        ? txtDesc.substring(0, this.config.lengthDescription) + "..."
                        : txtDesc
                    : txtDesc;
                content.appendChild(description);
            }
        }
        
        return content;
    },

    notificationReceived: function (notification, payload, sender) {
        if (notification === "MODULE_DOM_UPDATED") {
            // An animated updateDom (auto scroll) renders its DOM up front and swaps it in
            // only after the fade-out. If the article was opened in between, that stale
            // news bar replaces it - render the article again.
            if (
                this.config.showFullArticle &&
                this.newsItems.length > 0 &&
                !document.querySelector("#" + this.identifier + " .article-content, #" + this.identifier + " .full-article-iframe")
            ) {
                Log.info(this.name + " - full article overwritten by a stale update, rendering it again");
                this.updateDom(0);
            }
        } else if (notification === "ARTICLE_NEXT") {
            // Pause auto scroll immediately when gesture is detected
            this.pauseAutoScroll();
            this.animateArticleChange("right");
        } else if (notification === "ARTICLE_PREVIOUS") {
            // Pause auto scroll immediately when gesture is detected
            this.pauseAutoScroll();
            this.animateArticleChange("left");
        }
        // if "more details" is received the first time: show article summary, on second time show full article
        else if (notification === "ARTICLE_MORE_DETAILS") {
            // Reset article timeout on gesture
            if (this.config.showFullArticle) {
                this.startArticleTimeout();
            }
            
            // full article is already showing, so scrolling down
            if (this.config.showFullArticle === true) {
                this.scrollPosition += this.config.scrollLength;
                this.smoothScrollTo(this.scrollPosition);
                Log.info(this.name + " - scrolling down");
                Log.info(
                    this.name +
                        " - ARTICLE_MORE_DETAILS, scroll position: " +
                        this.config.scrollLength
                );
            } else {
                // Pause auto scroll when opening full article
                this.pauseAutoScroll();
                this.showFullArticle();
            }
        } else if (notification === "ARTICLE_SCROLL_UP") {
            // Reset article timeout on gesture
            if (this.config.showFullArticle) {
                this.startArticleTimeout();
            }
            
            if (this.config.showFullArticle === true) {
                this.scrollPosition -= this.config.scrollLength;
                this.smoothScrollTo(this.scrollPosition);
                Log.info(this.name + " - scrolling up");
                Log.info(
                    this.name +
                        " - ARTICLE_SCROLL_UP, scroll position: " +
                        this.config.scrollLength
                );
            }
        } else if (notification === "ARTICLE_LESS_DETAILS") {
            this.resetDescrOrFullArticleAndTimer();
            Log.info(this.name + " - showing only article titles again");
        } else if (notification === "ARTICLE_TOGGLE_FULL") {
            if (this.config.showFullArticle) {
                this.activeItem++;
                this.resetDescrOrFullArticleAndTimer();
            } else {
                this.showFullArticle();
            }
        } else if (notification === "ARTICLE_INFO_REQUEST") {
            this.sendNotification("ARTICLE_INFO_RESPONSE", {
                title: this.newsItems[this.activeItem].title,
                source: this.newsItems[this.activeItem].sourceTitle,
                date: this.newsItems[this.activeItem].pubdate,
                desc: this.newsItems[this.activeItem].description,
                url: this.getActiveItemURL(),
            });
        }
    },

    showFullArticle: function () {
        var self = this;
        
        // If animation is in progress, wait for it to complete
        if (this.animationDirection) {
            Log.info(this.name + " - Article change animation in progress, delaying full article opening");
            setTimeout(function() {
                self.showFullArticle();
            }, 600); // Wait for animation to complete (200ms slide out + 400ms slide in)
            return;
        }
        
        // Check if we have news items and current item is valid
        if (this.newsItems.length === 0 || !this.newsItems[this.activeItem]) {
            Log.info(this.name + " - No news items available or invalid active item, cannot show full article");
            return;
        }
        
        // If we're about to show full article, show loading overlay immediately
        if (!this.config.showFullArticle) {
            // Set article opening flag to prevent auto scroll
            self.articleOpeningInProgress = true;
            
            // Set timeout to clear the flag in case something goes wrong
            if (self.articleOpeningTimeout) {
                clearTimeout(self.articleOpeningTimeout);
            }
            self.articleOpeningTimeout = setTimeout(function() {
                if (self.articleOpeningInProgress) {
                    Log.info(self.name + " - Clearing article opening flag due to timeout");
                    self.articleOpeningInProgress = false;
                }
            }, 5000); // 5 second timeout
            
            // Show loading overlay immediately
            self.showLoadingOverlay();
            
            // Set full article state immediately
            self.isShowingDescription = !self.isShowingDescription;
            self.config.showFullArticle = !self.isShowingDescription;
            
            // make bottom bar align to top to allow scrolling; the offset is measured
            // rather than fixed, because body gap and custom.css shifts vary per setup
            if (self.config.showFullArticle === true) {
                var bottomBar = document.getElementsByClassName("region bottom bar")[0];
                var bodyTop = document.body.getBoundingClientRect().top + window.scrollY;
                bottomBar.style.bottom = "inherit";
                bottomBar.style.top =
                    -(bodyTop + document.getElementById(self.identifier).offsetTop) + "px";
            }
            // Pause auto scroll when showing full article
            self.fullArticlePaused = true;
            if (self.timer) {
                clearInterval(self.timer);
                self.timer = null;
            }
            
            // Start timeout for full article
            if (self.config.showFullArticle) {
                self.startArticleTimeout();
            }
            
            Log.info(
                self.name + " - showing " + (self.isShowingDescription
                    ? "article description"
                    : "full article") + " - auto scroll paused"
            );
            
            // Double-check that activeItem is still valid after setting the lock
            if (self.newsItems.length === 0 || !self.newsItems[self.activeItem]) {
                Log.info(self.name + " - Active item became invalid during article opening, aborting");
                self.articleOpeningInProgress = false;
                if (self.articleOpeningTimeout) {
                    clearTimeout(self.articleOpeningTimeout);
                    self.articleOpeningTimeout = null;
                }
                self.hideLoadingOverlay();
                return;
            }
            
            // Update DOM to create the full article content
            self.updateDom(0);
        } else {
            // Just toggle normally if already showing full article
            this.isShowingDescription = !this.isShowingDescription;
            this.config.showFullArticle = !this.isShowingDescription;
            this.updateDom(0);
        }
    },

    showLoadingOverlay: function () {
        var self = this;
        
        // Create loading overlay if it doesn't exist
        var overlay = document.getElementById('newsfeed-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'newsfeed-loading-overlay';
            overlay.className = 'newsfeed-loading-overlay';
            
            // Create loading content
            var loadingContent = document.createElement('div');
            loadingContent.style.display = 'flex';
            loadingContent.style.flexDirection = 'column';
            loadingContent.style.alignItems = 'center';
            
            // Create spinner
            var spinner = document.createElement('div');
            spinner.className = 'newsfeed-loading-spinner';
            
            // Create loading text
            var loadingText = document.createElement('div');
            loadingText.className = 'newsfeed-loading-text';
            loadingText.textContent = self.translate('LOADING_ARTICLE');
            
            loadingContent.appendChild(spinner);
            loadingContent.appendChild(loadingText);
            overlay.appendChild(loadingContent);
            
            document.body.appendChild(overlay);
        }
        
        // Show overlay with animation
        overlay.classList.add('show');
        Log.info(this.name + " - Loading overlay shown");
    },

    hideLoadingOverlay: function () {
        var overlay = document.getElementById('newsfeed-loading-overlay');
        if (overlay) {
            overlay.classList.remove('show');
            // Remove overlay after animation completes
            setTimeout(function() {
                if (overlay && overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 500);
            Log.info(this.name + " - Loading overlay hidden");
        }
    },

    // https://stackoverflow.com/a/7467863
    nl2br(str, is_xhtml) {
        if (typeof str === "undefined" || str === null) {
            return "";
        }
        var breakTag =
            is_xhtml || typeof is_xhtml === "undefined" ? "<br />" : "<br>";
        return (str + "").replace(
            /([^>\r\n]?)(\r\n|\n\r|\r|\n)/g,
            "$1" + breakTag + "$2"
        );
    },

    getStyles: function () {
        return [this.file("style.css")];
    },
});
