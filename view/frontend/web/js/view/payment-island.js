/**
 * Payment island bootstrap.
 *
 * Boots ONLY the stock Knockout payment subtree of the checkout jsLayout, into the
 * #fastcheckout-payment node, using Magento's own Magento_Ui/js/core/app. Because we extract
 * the payment node from the fully-merged jsLayout, it already contains every installed payment
 * method's renderer (Braintree, Stripe, PayPal, Vault, offline…) AND the ReCaptcha place-order
 * node — so no per-method code is needed here.
 *
 * Critical invariants:
 *  - window.checkoutConfig MUST already be set (payment/quote modules read it at eval time).
 *  - The registry path must stay checkout.steps.billing-step.payment.* because payments-list
 *    depends on the absolute paths ...payment.renders / ...payment.additional-payment-validators.
 *    We therefore reproduce the full key nesting (checkout → steps → billing-step → payment)
 *    plus the top-level checkoutProvider sibling.
 */
define(['Magento_Ui/js/core/app'], function (app) {
    'use strict';

    var booted = false;

    /**
     * Read the store-static payment jsLayout. Prefers the cache-safe JSON data island
     * (<script type="application/json" id="fastcheckout-jslayout">) the template now emits;
     * falls back to a legacy inline window.fastCheckoutJsLayout global if present.
     *
     * @return {Object|null}
     */
    function readJsLayout() {
        if (window.fastCheckoutJsLayout) {
            return window.fastCheckoutJsLayout;
        }
        var el = document.getElementById('fastcheckout-jslayout');

        if (el && el.textContent) {
            try {
                return JSON.parse(el.textContent);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    /**
     * Wrap an original container node, keeping its component/config but replacing children.
     *
     * @param {Object} node
     * @param {Object} children
     * @return {Object}
     */
    function shell(node, children) {
        node = node || {};
        return {
            component: node.component || 'uiComponent',
            config: node.config,
            children: children
        };
    }

    /**
     * Return a shallow clone of a children map with one key removed (non-mutating).
     *
     * @param {Object} children
     * @param {String} key
     * @return {Object}
     */
    function stripChild(children, key) {
        var copy = {};
        Object.keys(children || {}).forEach(function (k) {
            if (k !== key) {
                copy[k] = children[k];
            }
        });
        return copy;
    }

    /**
     * Build a partial jsLayout containing just the payment subtree + checkoutProvider,
     * preserving the exact registry-name nesting the payment components depend on.
     *
     * @param {Object} full - the complete window.fastCheckoutJsLayout
     * @return {Object|null}
     */
    function extractPayment(full) {
        if (!full || !full.components) {
            return null;
        }
        var comps = full.components,
            checkout = comps.checkout || {},
            steps = (checkout.children || {}).steps || {},
            billing = (steps.children || {})['billing-step'] || {},
            payment = (billing.children || {}).payment;

        if (!payment) {
            return null;
        }

        // Strip the payment step's own email input — the instant form's contact field is the
        // single canonical email, so keeping this would show the shopper a duplicate email box.
        payment = shell(payment, stripChild(payment.children, 'customer-email'));

        return {
            types: full.types || {},
            components: {
                checkout: shell(checkout, {
                    steps: shell(steps, {
                        'billing-step': shell(billing, {
                            payment: payment
                        })
                    })
                }),
                checkoutProvider: comps.checkoutProvider
            }
        };
    }

    return {
        /**
         * Boot the payment island once. Safe to call repeatedly.
         */
        boot: function () {
            if (booted) {
                return;
            }
            if (typeof window.checkoutConfig === 'undefined') {
                return;
            }
            var jsLayout = readJsLayout();

            if (!jsLayout) {
                return;
            }
            var partial = extractPayment(jsLayout);

            if (!partial) {
                return;
            }
            booted = true;
            app(partial);
        },

        /**
         * @return {Boolean}
         */
        isBooted: function () {
            return booted;
        }
    };
});
