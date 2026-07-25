/**
 * Async loader for window.checkoutConfig.
 *
 * The instant checkout shell is cacheable precisely because it does NOT inline the
 * per-quote checkoutConfig. This module fetches it from the fastcheckout/config endpoint
 * and installs the same globals the stock onepage template would have, BEFORE any
 * Knockout payment module is required (those read window.checkoutConfig at eval time).
 *
 * Uses the native Fetch API (not jQuery $.ajax) so it behaves identically under Breeze's
 * cash-dom runtime and stock jQuery. On repeated hard failure it redirects to the
 * guaranteed-stock checkout (?fastcheckout=0) so the shopper is never stranded.
 */
define([], function () {
    'use strict';

    var loadPromise = null;

    /**
     * Hydrate the real checkoutConfig into whatever is already on the page.
     *
     * The template inlines a minimal static skeleton (so eager third-party modules — e.g.
     * Stripe's minicart components — can read window.checkoutConfig at eval without throwing).
     * We MERGE the real data into that existing object, preserving the identity of top-level
     * sub-objects (quoteData, totalsData, priceFormat) that modules like quote.js capture by
     * reference at eval time. Without this, a replace would leave those modules pointing at the
     * empty skeleton.
     *
     * @param {Object} data
     */
    function applyConfig(data) {
        if (!window.checkoutConfig || typeof window.checkoutConfig !== 'object') {
            window.checkoutConfig = data;
        } else {
            // Deep-merge into the existing object, preserving the identity of every object/array
            // already present — modules like quote.js capture sub-objects (quoteData, totalsData)
            // by reference at eval time, so those exact references must receive the real values.
            deepMergeInto(window.checkoutConfig, data);
        }

        window.isCustomerLoggedIn = window.checkoutConfig.isCustomerLoggedIn;
        window.customerData = window.checkoutConfig.customerData;
    }

    /**
     * Recursively copy source into target, mutating existing nested objects/arrays in place
     * (identity-preserving) rather than replacing them.
     *
     * @param {Object} target
     * @param {Object} source
     */
    function deepMergeInto(target, source) {
        Object.keys(source).forEach(function (key) {
            var sv = source[key],
                tv = target[key];

            if (Array.isArray(sv)) {
                if (Array.isArray(tv)) {
                    tv.length = 0;
                    sv.forEach(function (item) { tv.push(item); });
                } else {
                    target[key] = sv;
                }
            } else if (sv && typeof sv === 'object') {
                if (!tv || typeof tv !== 'object' || Array.isArray(tv)) {
                    target[key] = {};
                }
                deepMergeInto(target[key], sv);
            } else {
                target[key] = sv;
            }
        });
    }

    /**
     * Fetch JSON with a timeout, resolving null on any non-OK / abort / network error.
     *
     * @param {String} url
     * @param {Number} timeoutMs
     * @return {Promise<Object|null>}
     */
    function fetchJson(url, timeoutMs) {
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null,
            timer = window.setTimeout(function () {
                if (controller) {
                    controller.abort();
                }
            }, timeoutMs);

        return window.fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
            signal: controller ? controller.signal : undefined
        }).then(function (response) {
            window.clearTimeout(timer);
            return response.ok ? response.json() : null;
        }).catch(function () {
            window.clearTimeout(timer);
            return null;
        });
    }

    return {
        /**
         * @param {Object} opts - {configUrl, fallbackUrl, retries}
         * @return {Promise} resolves with the checkoutConfig object
         */
        load: function (opts) {
            if (loadPromise) {
                return loadPromise;
            }

            var retries = typeof opts.retries === 'number' ? opts.retries : 2;

            loadPromise = new Promise(function (resolve, reject) {
                var attempt = function (remaining) {
                    fetchJson(opts.configUrl, 20000).then(function (data) {
                        if (data && !data.error) {
                            applyConfig(data);
                            resolve(data);
                            return;
                        }
                        if (remaining > 0) {
                            window.setTimeout(function () {
                                attempt(remaining - 1);
                            }, 600);
                            return;
                        }
                        // Degrade to guaranteed-stock checkout rather than leave a dead page.
                        if (opts.fallbackUrl && window.location.search.indexOf('fastcheckout=0') === -1) {
                            window.location.href = opts.fallbackUrl;
                        }
                        reject(new Error('fastcheckout: checkout config failed to load'));
                    });
                };

                attempt(retries);
            });

            return loadPromise;
        },

        /**
         * @return {Boolean}
         */
        isLoaded: function () {
            return typeof window.checkoutConfig !== 'undefined';
        }
    };
});
