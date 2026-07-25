/**
 * Checkout preloader.
 *
 * When the cart is non-empty, speculatively load the checkout page so that clicking
 * "Checkout" from the minicart/cart has no "waiting for server" delay. Uses the Speculation
 * Rules API (prerender — the page, including its async config fetch, is built in the
 * background) where supported, and falls back to <link rel="prefetch"> (document prefetch)
 * elsewhere. Re-evaluates whenever the cart section changes.
 *
 * Mounted site-wide (default.xml). Self-guards: never runs on the checkout page itself, and
 * does nothing until the cart has items.
 */
define(['Magento_Customer/js/customer-data'], function (customerData) {
    'use strict';

    return function (config) {
        var checkoutUrl = (config && config.checkoutUrl) || '/checkout',
            done = false;

        // No point preloading checkout while already on it.
        if (/\/checkout(\/|$|\?)/.test(window.location.pathname + window.location.search)) {
            return;
        }

        function preload() {
            if (done) {
                return;
            }
            var cart = customerData.get('cart')();

            if (!cart || !Number(cart.summary_count)) {
                return;
            }
            done = true;

            // Preferred: Speculation Rules prerender (fully builds the page in the background).
            try {
                if (typeof HTMLScriptElement !== 'undefined' &&
                    HTMLScriptElement.supports &&
                    HTMLScriptElement.supports('speculationrules')
                ) {
                    var rules = document.createElement('script');

                    rules.type = 'speculationrules';
                    rules.textContent = JSON.stringify({
                        prerender: [{ source: 'list', urls: [checkoutUrl] }]
                    });
                    document.head.appendChild(rules);
                    return;
                }
            } catch (e) { /* fall through to link prefetch */ }

            // Fallback: prefetch the checkout document so the HTML is ready on click.
            var link = document.createElement('link');

            link.rel = 'prefetch';
            link.href = checkoutUrl;
            link.as = 'document';
            document.head.appendChild(link);
        }

        preload();
        customerData.get('cart').subscribe(preload);
    };
});
