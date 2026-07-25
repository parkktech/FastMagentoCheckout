/**
 * fastCheckout — the instant checkout form controller.
 *
 * Authored as a plain Magento AMD component (mounted via data-mage-init) so it runs
 * identically under Breeze's runtime and stock Magento. It owns the static contact +
 * shipping-address inputs (interactive at first paint) and acts as thin glue over
 * Magento's OWN checkout modules — it does not re-implement quote/rate logic:
 *
 *   form input  -> address-converter -> create/select-shipping-address (auto-triggers rates)
 *   rate click  -> select-shipping-method -> set-shipping-information (reveals payment)
 *   summary     <- customer-data 'cart' section + quote.totals
 *
 * checkoutConfig-dependent modules (quote, actions) are required LAZILY, only after the
 * async config has installed window.checkoutConfig — they read it at module-eval time.
 */
define([
    'jquery',
    'ParkkTech_FastMagentoCheckout/js/view/config-loader',
    'Magento_Customer/js/customer-data'
], function ($, configLoader, customerData) {
    'use strict';

    /**
     * @param {Object} config - options from data-mage-init
     * @param {HTMLElement} root
     */
    function FastCheckout(config, root) {
        this.config = config || {};
        this.root = root;
        this.m = null;            // lazily-loaded Magento modules
        this.rendered = { rates: false };
        this.init();
    }

    FastCheckout.prototype = {

        init: function () {
            this.cacheDom();
            this.initRegionField();
            this.initSummary();
            this.wireInlineValidation();
            this.initSavedAddresses();
            this.initAddressAutocomplete();
            this.loadConfig();
        },

        cacheDom: function () {
            var r = this.root;
            this.el = {
                email:          r.querySelector('[data-role="fc-email"]'),
                emailForm:      r.querySelector('form[data-role="email-with-possible-login"]'),
                loginHint:      r.querySelector('[data-role="fc-login-hint"]'),
                form:           r.querySelector('[data-role="fc-address-form"]'),
                country:        r.querySelector('[data-role="fc-country"]'),
                regionSelect:   r.querySelector('[data-role="fc-region-select"]'),
                regionInput:    r.querySelector('[data-role="fc-region-input"]'),
                methods:        r.querySelector('[data-role="fc-shipping-methods"]'),
                methodsHint:    r.querySelector('[data-role="fc-shipping-hint"]'),
                summary:        r.querySelector('[data-role="fc-summary"]'),
                messages:       r.querySelector('[data-role="fastcheckout-messages"]')
            };
        },

        /* ---------------------------------------------------------------- region field */

        initRegionField: function () {
            var self = this,
                map = this.config.regionMap || {},
                required = this.config.requiredRegionCountries || [];

            this.regionMap = map;
            this.requiredRegionCountries = required;

            if (!this.el.country) {
                return;
            }
            this.el.country.addEventListener('change', function () {
                self.renderRegionField(this.value);
            });
            // Paint the correct region control immediately for the pre-selected country.
            this.renderRegionField(this.el.country.value);
        },

        renderRegionField: function (countryCode) {
            var regions = this.regionMap[countryCode],
                sel = this.el.regionSelect,
                input = this.el.regionInput,
                isRequired = this.requiredRegionCountries.indexOf(countryCode) !== -1;

            if (regions && regions.length) {
                var html = '<option value="">' +
                    (isRequired ? '' : '') + '</option>';
                regions.forEach(function (region) {
                    html += '<option value="' + region.id + '" data-code="' + region.code + '">' +
                        region.name + '</option>';
                });
                sel.innerHTML = html;
                sel.hidden = false;
                sel.required = isRequired;
                input.hidden = true;
                input.value = '';
            } else {
                sel.hidden = true;
                sel.required = false;
                sel.innerHTML = '';
                input.hidden = false;
            }
        },

        /* ---------------------------------------------------------------- inline validation */

        /**
         * Turn empty required fields red as the shopper moves past them — catches fields an
         * autocomplete skipped (commonly email and state). Works at first paint, before config.
         */
        wireInlineValidation: function () {
            var self = this,
                form = this.el.form;

            if (!form) {
                return;
            }
            var isEmpty = function (el) { return !el || !el.value || !el.value.trim(); };

            // The email is wrapped in a real <form data-role=email-with-possible-login> (required
            // by the stock place-order validator). It has no server action, so pressing Enter
            // would reload the page — swallow its submit.
            if (this.el.emailForm) {
                this.el.emailForm.addEventListener('submit', function (e) { e.preventDefault(); });
            }

            // Clear the red state as soon as the shopper types/selects a value.
            form.addEventListener('input', function (e) {
                if (e.target && e.target.classList) { e.target.classList.remove('fc-invalid'); }
            });
            form.addEventListener('change', function (e) {
                if (e.target && e.target.classList && !isEmpty(e.target)) {
                    e.target.classList.remove('fc-invalid');
                }
            });

            // Leaving a required field empty flags it.
            form.addEventListener('focusout', function (e) {
                if (self.isFieldRequired(e.target) && isEmpty(e.target)) {
                    e.target.classList.add('fc-invalid');
                }
            });

            // Focusing a field flags any empty required field ABOVE it (the autocomplete case:
            // the skipped field was never focused, so only this catches it).
            form.addEventListener('focusin', function (e) {
                var fields = Array.prototype.slice.call(form.querySelectorAll('input[name], select[name]')),
                    idx = fields.indexOf(e.target);

                fields.forEach(function (el, i) {
                    if (i < idx && self.isFieldRequired(el) && isEmpty(el)) {
                        el.classList.add('fc-invalid');
                    }
                });
            });

            // Email lives outside the address form — validate it the same way.
            if (this.el.email) {
                this.el.email.addEventListener('input', function () {
                    self.el.email.classList.remove('fc-invalid');
                });
                this.el.email.addEventListener('blur', function () {
                    if (!window.isCustomerLoggedIn && isEmpty(self.el.email)) {
                        self.el.email.classList.add('fc-invalid');
                    }
                });
            }
        },

        /**
         * @param {HTMLElement} el
         * @return {Boolean}
         */
        isFieldRequired: function (el) {
            if (!el || !el.name) {
                return false;
            }
            if (el.name === 'region_id') {
                // Only required when the country actually has a (visible) region dropdown.
                return this.el.regionSelect && !this.el.regionSelect.hidden;
            }
            return ['firstname', 'lastname', 'street[0]', 'city', 'postcode', 'country_id', 'telephone']
                .indexOf(el.name) !== -1;
        },

        /* ---------------------------------------------------------------- address autocomplete */

        /**
         * Wire Google Places autocomplete onto the street field, if enabled + keyed. The Maps JS
         * API is loaded lazily (only on the checkout, only when configured); on any failure the
         * field silently stays a plain input. The module's CSP whitelist allows the Maps hosts.
         */
        initAddressAutocomplete: function () {
            var self = this,
                street = this.el.form ? this.el.form.querySelector('#fc-street0') : null;

            if (!this.config.addressAutocomplete || !this.config.googleMapsApiKey || !street) {
                return;
            }
            this.loadGoogleMaps(this.config.googleMapsApiKey).then(function () {
                self.setupAutocomplete(street);
            }).catch(function () { /* leave the plain address form in place */ });
        },

        /**
         * Idempotently load the Google Maps JS API (Places library). Resolves once google.maps.places
         * is available.
         *
         * @param {String} key
         * @return {Promise}
         */
        loadGoogleMaps: function (key) {
            if (window.google && window.google.maps && window.google.maps.places) {
                return Promise.resolve();
            }
            if (this._mapsPromise) {
                return this._mapsPromise;
            }
            this._mapsPromise = new Promise(function (resolve, reject) {
                // Fixed global callback name — safe because _mapsPromise guarantees a single loader.
                var cb = 'fcGmapsReady';
                window[cb] = function () {
                    resolve();
                    try { delete window[cb]; } catch (e) { window[cb] = undefined; }
                };
                var s = document.createElement('script');
                s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
                    '&libraries=places&loading=async&callback=' + cb;
                s.async = true;
                s.onerror = function () { reject(new Error('fastcheckout: Google Maps failed to load')); };
                document.head.appendChild(s);
            });
            return this._mapsPromise;
        },

        /**
         * Attach the Places Autocomplete widget to the street input and bias it to the selected
         * country. On selection, populate every address field and drive the normal sync pipeline.
         *
         * @param {HTMLElement} streetInput
         */
        setupAutocomplete: function (streetInput) {
            var self = this;

            if (!(window.google && google.maps && google.maps.places)) {
                return;
            }
            var ac = new google.maps.places.Autocomplete(streetInput, {
                types: ['address'],
                fields: ['address_components']
            });
            var restrict = function () {
                var c = self.el.country ? self.el.country.value : '';
                try { ac.setComponentRestrictions(c ? { country: c.toLowerCase() } : {}); } catch (e) { /* noop */ }
            };

            restrict();
            if (self.el.country) {
                self.el.country.addEventListener('change', restrict);
            }
            ac.addListener('place_changed', function () {
                var place = ac.getPlace();
                if (place && place.address_components) {
                    self.fillFromPlace(place.address_components);
                }
            });
            // Stop the browser's native autofill dropdown fighting the Places suggestions list.
            streetInput.setAttribute('autocomplete', 'off');
        },

        /**
         * Populate the address fields from a Places address_components array, then hand off to the
         * widget's own hint + quote/rate sync (setInput does not fire input events those listen for).
         *
         * @param {Array} components
         */
        fillFromPlace: function (components) {
            var get = function (type, useShort) {
                for (var i = 0; i < components.length; i++) {
                    if (components[i].types.indexOf(type) !== -1) {
                        return useShort ? components[i].short_name : components[i].long_name;
                    }
                }
                return '';
            };
            var streetNumber = get('street_number'),
                route = get('route'),
                subpremise = get('subpremise'),
                city = get('locality') || get('postal_town') || get('sublocality') || get('sublocality_level_1'),
                stateShort = get('administrative_area_level_1', true),
                stateLong = get('administrative_area_level_1'),
                postcode = get('postal_code'),
                countryShort = get('country', true);

            // Country first — it re-renders the region control for the new country.
            if (countryShort && this.el.country && this.el.country.value !== countryShort) {
                this.el.country.value = countryShort;
                this.renderRegionField(countryShort);
            }
            this.setInput('street[0]', (streetNumber ? streetNumber + ' ' : '') + route);
            if (subpremise) {
                this.setInput('street[1]', subpremise);
            }
            this.setInput('city', city);
            this.setInput('postcode', postcode);

            // Region: match the dropdown by region code (else name); fall back to free-text input.
            if (this.el.regionSelect && !this.el.regionSelect.hidden) {
                var id = this.matchRegionId(stateShort, stateLong);
                if (id) {
                    this.el.regionSelect.value = id;
                }
            } else if (this.el.regionInput) {
                this.el.regionInput.value = stateLong || stateShort;
            }

            this.clearFilledInvalidFlags();
            this.updateShippingHint();
            this.syncAddress();
        },

        /**
         * Resolve a region_id from the store-static region map for the current country, matching
         * first by code (e.g. "TX") then by full name.
         *
         * @param {String} code
         * @param {String} name
         * @return {String}
         */
        matchRegionId: function (code, name) {
            var country = this.el.country ? this.el.country.value : '',
                regions = (this.regionMap && this.regionMap[country]) || [],
                i;

            for (i = 0; i < regions.length; i++) {
                if (code && regions[i].code === code) {
                    return regions[i].id;
                }
            }
            for (i = 0; i < regions.length; i++) {
                if (name && regions[i].name === name) {
                    return regions[i].id;
                }
            }
            return '';
        },

        /** Clear the red "required" flag from any field the autocomplete just filled. */
        clearFilledInvalidFlags: function () {
            if (!this.el.form) {
                return;
            }
            this.el.form.querySelectorAll('.fc-invalid').forEach(function (el) {
                if (el.value && el.value.trim()) {
                    el.classList.remove('fc-invalid');
                }
            });
        },

        /* ---------------------------------------------------------------- order summary */

        initSummary: function () {
            var self = this,
                cart = customerData.get('cart');

            this.maxSummaryItems = parseInt(this.config.maxSummaryItems, 10) || 10;

            // customer-data works without checkoutConfig, so the summary can paint at once.
            this.renderSummary(cart());
            cart.subscribe(function (data) {
                self.renderSummary(data);
            });

            // Recompute the items-list scroll cap whenever the layout can change height: the main
            // column growing (payment island booting, rates rendering) or the viewport resizing.
            var recompute = debounce(function () { self.applySummaryScroll(); }, 120);

            if (typeof window.ResizeObserver === 'function') {
                var main = this.root.querySelector('.fastcheckout-main');
                if (main) {
                    // Observe the MAIN column only — the summary lives in the sidebar, so resizing
                    // the items list can't feed back into what we observe (no observer loop).
                    this._mainObserver = new window.ResizeObserver(recompute);
                    this._mainObserver.observe(main);
                }
            }
            window.addEventListener('resize', recompute);
        },

        renderSummary: function (cart) {
            if (!this.el.summary || !cart) {
                return;
            }
            var items = cart.items || [],
                rows = '',
                totals = this.quoteTotals || null;

            items.forEach(function (item) {
                // product_image is resolved server-side by Magento's ItemResolver: for configurable
                // products it is the chosen simple's image, falling back to the parent when the
                // simple has none (store setting checkout/cart/configurable_product_image = itself).
                // Magento's customer-data already escapes product_name (DefaultItem), so render it
                // as-is; only escape the raw fallback name. image.alt is raw → escape it.
                var image = item.product_image || {},
                    name = item.product_name != null && item.product_name !== ''
                        ? item.product_name
                        : escapeHtml(item.name || ''),
                    thumb = image.src
                        ? '<span class="fc-summary-thumb">' +
                              '<img src="' + escapeHtml(image.src) + '" alt="' +
                              escapeHtml(image.alt || item.name || '') + '" ' +
                              'loading="lazy" width="72" height="72"/>' +
                          '</span>'
                        : '';

                rows +=
                    '<div class="fc-summary-item">' +
                        thumb +
                        '<span class="fc-summary-qty">' + (item.qty || 1) + '&times;</span>' +
                        '<span class="fc-summary-name">' + name + '</span>' +
                        // product_price is a store-generated, preformatted currency HTML string.
                        '<span class="fc-summary-price">' + (item.product_price || '') + '</span>' +
                    '</div>';
            });

            var summaryHtml = '<div class="fc-summary-items">' + rows + '</div><div class="fc-summary-totals">';

            if (totals && totals.subtotal !== undefined) {
                // Numeric totals from the live quote → format consistently, no markup.
                summaryHtml += totalRow('Subtotal', this.formatPrice(totals.subtotal));
                if (parseFloat(totals.discount_amount)) {
                    summaryHtml += totalRow('Discount', this.formatPrice(totals.discount_amount));
                }
                if (totals.shipping_amount !== undefined && this.rendered.rates) {
                    summaryHtml += totalRow('Shipping', this.formatPrice(totals.shipping_amount));
                }
                if (totals.tax_amount) {
                    summaryHtml += totalRow('Tax', this.formatPrice(totals.tax_amount));
                }
                summaryHtml += totalRow('Order Total', this.formatPrice(totals.grand_total), true);
            } else {
                // Before the quote totals arrive: the cart section's subtotal is a preformatted
                // currency HTML string — insert as-is (store-generated, not user input).
                summaryHtml += totalRowRaw('Subtotal', cart.subtotal || '');
            }
            summaryHtml += '</div>';
            this.el.summary.innerHTML = summaryHtml;
            this.applySummaryScroll();
        },

        /**
         * Cap the height of the summary items list so it scrolls internally instead of pushing the
         * order summary past the bottom of the payment form. The cap is the SMALLER of:
         *   - the stock "max items to display" setting (checkout/sidebar/max_items_display_count),
         *     rendered as that many item rows — the default when the form is tall enough; and
         *   - the space left before the summary would extend below the main column's bottom.
         * With few items neither binds and nothing scrolls.
         */
        applySummaryScroll: function () {
            if (!this.el.summary) {
                return;
            }
            var box = this.el.summary.querySelector('.fc-summary-items'),
                totals = this.el.summary.querySelector('.fc-summary-totals');

            if (!box || !box.children.length) {
                return;
            }
            var rowH = box.children[0].getBoundingClientRect().height || 60,
                countLimit = this.maxSummaryItems * rowH,
                formLimit = Infinity,
                main = this.root.querySelector('.fastcheckout-main');

            if (main) {
                var mainBottom = main.getBoundingClientRect().bottom,
                    boxTop = box.getBoundingClientRect().top,
                    reserve = (totals ? totals.getBoundingClientRect().height : 0) + 24;

                formLimit = mainBottom - boxTop - reserve;
            }
            var maxH = Math.min(countLimit, formLimit);

            // Only scroll when the content genuinely overflows the cap; keep at least one row tall.
            if (maxH > 0 && box.scrollHeight > maxH + 2) {
                box.style.maxHeight = Math.max(rowH, maxH) + 'px';
                box.classList.add('fc-summary-scroll');
            } else {
                box.style.maxHeight = '';
                box.classList.remove('fc-summary-scroll');
            }
        },

        /* ---------------------------------------------------------------- async config */

        loadConfig: function () {
            var self = this;
            configLoader.load({
                configUrl: this.config.configUrl,
                fallbackUrl: this.config.fallbackUrl
            }).then(function (checkoutConfig) {
                self.onConfigReady(checkoutConfig);
            }).catch(function () {
                // config-loader already redirected to stock checkout on hard failure.
            });
        },

        onConfigReady: function () {
            var self = this;

            require([
                'mage/url',
                'Magento_Checkout/js/model/quote',
                'Magento_Checkout/js/model/address-converter',
                'Magento_Checkout/js/action/create-shipping-address',
                'Magento_Checkout/js/action/select-shipping-address',
                'Magento_Checkout/js/model/shipping-service',
                'Magento_Checkout/js/action/select-shipping-method',
                'Magento_Checkout/js/action/set-shipping-information',
                'Magento_Checkout/js/checkout-data',
                'Magento_Catalog/js/price-utils',
                // Loading this registers the quote.shippingAddress subscription that actually
                // FETCHES rates on address change. The stock shipping component pulls it in; our
                // custom form must load it explicitly or no rates are ever estimated.
                'Magento_Checkout/js/model/shipping-rate-service',
                'uiRegistry'
            ], function (
                url, quote, addressConverter, createShippingAddress, selectShippingAddress,
                shippingService, selectShippingMethod, setShippingInformation, checkoutData, priceUtils,
                registry
            ) {
                url.setBaseUrl(self.config.baseUrl);

                self.m = {
                    quote: quote,
                    addressConverter: addressConverter,
                    createShippingAddress: createShippingAddress,
                    selectShippingAddress: selectShippingAddress,
                    shippingService: shippingService,
                    selectShippingMethod: selectShippingMethod,
                    setShippingInformation: setShippingInformation,
                    checkoutData: checkoutData,
                    priceUtils: priceUtils,
                    registry: registry
                };

                // quote.js may have evaluated against the inline skeleton (via an eager
                // third-party module) before the real config was merged in. The merge updates
                // the captured objects in place; nudge the totals observable so any subscribers
                // re-read the now-hydrated values.
                if (quote.totals && typeof quote.totals.valueHasMutated === 'function') {
                    quote.totals.valueHasMutated();
                }

                self.isVirtual = !!(window.checkoutConfig.quoteData &&
                    Number(window.checkoutConfig.quoteData.is_virtual));

                // For VIRTUAL carts the form above is the billing address, so suppress the
                // payment step's own billing UI. For physical/mixed carts we KEEP the native
                // per-method billing (its "My billing and shipping address are the same" toggle
                // is exactly the different-billing option shoppers need).
                if (self.isVirtual) {
                    window.checkoutConfig.displayBillingOnPaymentMethod = false;
                }

                self.prefill();
                self.wireEmail();
                self.wireAddress();

                if (self.isVirtual) {
                    // No shipping for downloadable/virtual carts: the address form becomes the
                    // BILLING address (set on the quote below), and only the shipping-method
                    // step is hidden. Collecting billing here means the payment methods show a
                    // filled summary instead of an empty per-method address form.
                    self.configureForVirtual();
                } else {
                    self.subscribeRates();
                }

                self.subscribeTotals();
                self.bootPaymentIsland();

                // If a complete address was prefilled (returning or logged-in shopper), kick the
                // hint + quote/rate sync now so shipping options appear without any typing.
                self.updateShippingHint();
                self.syncAddress();
            });
        },

        /* ---------------------------------------------------------------- saved addresses (in-memory) */

        /**
         * Wire the logged-in customer's saved addresses, read from the `fastcheckout-customer`
         * customer-data section — i.e. from browser localStorage, with NO server/SQL call on the
         * checkout page. Prefills the default address at first paint and renders a picker to switch
         * between the others. Re-runs if the section loads late (first page after login).
         */
        initSavedAddresses: function () {
            var self = this,
                section = customerData.get('fastcheckout-customer');

            var apply = function (data) {
                self.savedAddresses = (data && data.addresses) || {};
                self.renderSavedAddressPicker(data || {});
            };

            apply(section());
            section.subscribe(apply);
        },

        /**
         * Build/refresh the saved-address CAROUSEL and auto-select the default address once.
         * A horizontally-scrollable strip of address cards (with prev/next) handles many saved
         * addresses cleanly; the trailing card clears the form for a brand-new address.
         *
         * @param {Object} data - the fastcheckout-customer section payload
         */
        renderSavedAddressPicker: function (data) {
            var self = this,
                addresses = (data && data.addresses) || {},
                ids = Object.keys(addresses);

            // Seed the email field from the in-memory section (no request), for logged-in shoppers.
            if (data && data.isLoggedIn && data.email && this.el.email && !this.el.email.value) {
                this.el.email.value = data.email;
            }
            if (!data || !data.isLoggedIn || !ids.length || !this.el.form) {
                return;
            }

            // Build the carousel shell once, inserted above the address form.
            if (!this.el.addressCarousel) {
                var wrap = document.createElement('div');
                wrap.className = 'fc-address-saved';
                wrap.setAttribute('data-role', 'fc-saved-address-wrap');
                wrap.innerHTML =
                    '<div class="fc-address-saved-head">' +
                        '<span class="fc-address-saved-title">' + escapeHtml('Ship to a saved address') + '</span>' +
                        '<span class="fc-address-saved-hint" data-role="fc-address-hint"></span>' +
                    '</div>' +
                    '<div class="fc-address-carousel">' +
                        '<button type="button" class="fc-address-nav fc-address-prev" aria-label="' +
                            escapeHtml('Previous') + '">‹</button>' +
                        '<div class="fc-address-track" data-role="fc-address-track"></div>' +
                        '<button type="button" class="fc-address-nav fc-address-next" aria-label="' +
                            escapeHtml('Next') + '">›</button>' +
                    '</div>';
                this.el.form.parentNode.insertBefore(wrap, this.el.form);
                this.el.addressCarousel = wrap;
                this.el.addressTrack = wrap.querySelector('[data-role="fc-address-track"]');
                this.el.addressHint = wrap.querySelector('[data-role="fc-address-hint"]');

                var step = function (dir) {
                    var card = self.el.addressTrack.querySelector('.fc-address-card');
                    var by = card ? card.getBoundingClientRect().width + 12 : 240;
                    self.el.addressTrack.scrollBy({ left: dir * by, behavior: 'smooth' });
                };
                wrap.querySelector('.fc-address-prev').addEventListener('click', function () { step(-1); });
                wrap.querySelector('.fc-address-next').addEventListener('click', function () { step(1); });
                this.el.addressTrack.addEventListener('scroll', function () { self.updateCarouselNav(); });

                // Card selection via delegation (cards are rebuilt on section refresh).
                this.el.addressTrack.addEventListener('click', function (e) {
                    var card = e.target.closest ? e.target.closest('.fc-address-card') : null;
                    if (card) {
                        self.selectSavedAddress(card.getAttribute('data-id'), false);
                    }
                });
            }

            var defaultId = data.default_shipping && addresses[data.default_shipping]
                    ? data.default_shipping
                    : ids[0],
                // Leading "new address" card — always the first thing the shopper sees, so it's
                // discoverable no matter how many saved addresses follow. Selecting it clears the
                // form to type a fresh address.
                html = '<button type="button" class="fc-address-card fc-address-card-new" data-id="">' +
                        '<span class="fc-address-card-plus">+</span>' +
                        '<span class="fc-address-card-name">' + escapeHtml('New address') + '</span>' +
                        '<span class="fc-address-card-line">' + escapeHtml('Type a different one') + '</span>' +
                    '</button>';

            ids.forEach(function (id) {
                html += self.addressCardHtml(id, addresses[id]);
            });
            this.el.addressTrack.innerHTML = html;
            if (this.el.addressHint) {
                this.el.addressHint.textContent = ids.length + (ids.length === 1 ? ' saved' : ' saved');
            }

            // Auto-select the default once; on later refreshes keep the shopper's choice highlighted.
            if (!this._savedApplied) {
                this._savedApplied = true;
                this.selectSavedAddress(defaultId, true);
            } else {
                this.markSelectedCard(this._selectedAddressId, false);
            }
            this.updateCarouselNav();
        },

        /**
         * HTML for one address card.
         *
         * @param {String} id
         * @param {Object} a
         * @return {String}
         */
        addressCardHtml: function (id, a) {
            var name = ((a.firstname || '') + ' ' + (a.lastname || '')).trim(),
                street = (a.street && a.street[0]) || '',
                region = a.region_code || a.region || '',
                cityLine = ([a.city, region].filter(Boolean).join(', ') +
                    (a.postcode ? ' ' + a.postcode : '')).trim();

            return '<button type="button" class="fc-address-card" data-id="' + escapeHtml(id) + '">' +
                (a.default_shipping ? '<span class="fc-address-card-badge">' + escapeHtml('Default') + '</span>' : '') +
                '<span class="fc-address-card-name">' + escapeHtml(name) + '</span>' +
                '<span class="fc-address-card-line">' + escapeHtml(street) + '</span>' +
                '<span class="fc-address-card-line">' + escapeHtml(cityLine) + '</span>' +
                (a.company ? '<span class="fc-address-card-line fc-address-card-company">' + escapeHtml(a.company) + '</span>' : '') +
                '</button>';
        },

        /**
         * Select a saved address (or the "new address" card when id is empty): fill the form,
         * highlight the card, optionally centre it, and sync the quote.
         *
         * @param {String} id
         * @param {Boolean} centre
         */
        selectSavedAddress: function (id, centre) {
            this._selectedAddressId = id || '';
            if (id && this.savedAddresses[id]) {
                this.fillAddressForm(this.normalizeSavedAddress(this.savedAddresses[id]));
            } else {
                this.clearAddressForm();
            }
            this.markSelectedCard(this._selectedAddressId, centre);
            this.afterAddressChanged();
        },

        /**
         * Toggle the selected card highlight and, when requested, centre it in the track (scrolling
         * the strip horizontally only — never the page).
         *
         * @param {String} id
         * @param {Boolean} centre
         */
        markSelectedCard: function (id, centre) {
            if (!this.el.addressTrack) {
                return;
            }
            var track = this.el.addressTrack,
                cards = track.querySelectorAll('.fc-address-card');

            Array.prototype.forEach.call(cards, function (c) {
                var match = c.getAttribute('data-id') === (id || '');
                c.classList.toggle('is-selected', match);
                if (match && centre) {
                    var left = c.offsetLeft - (track.clientWidth - c.clientWidth) / 2;
                    track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
                }
            });
        },

        /** Enable/disable the prev/next buttons at the ends of the strip. */
        updateCarouselNav: function () {
            if (!this.el.addressCarousel || !this.el.addressTrack) {
                return;
            }
            var t = this.el.addressTrack,
                prev = this.el.addressCarousel.querySelector('.fc-address-prev'),
                next = this.el.addressCarousel.querySelector('.fc-address-next'),
                atStart = t.scrollLeft <= 2,
                atEnd = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2;

            if (prev) { prev.disabled = atStart; }
            if (next) { next.disabled = atEnd; }
        },

        /** Empty the address form (for the "New address" card). */
        clearAddressForm: function () {
            var self = this;
            ['firstname', 'lastname', 'company', 'street[0]', 'street[1]', 'city', 'postcode', 'telephone']
                .forEach(function (n) { self.setInput(n, ''); });
            if (this.el.regionSelect) { this.el.regionSelect.value = ''; }
            if (this.el.regionInput) { this.el.regionInput.value = ''; }
        },

        /**
         * Map a saved-address section record to the flat shape fillAddressForm expects.
         *
         * @param {Object} a
         * @return {Object}
         */
        normalizeSavedAddress: function (a) {
            return {
                firstname: a.firstname,
                lastname: a.lastname,
                company: a.company,
                street: a.street || [],
                city: a.city,
                region_id: a.region_id,
                region: a.region,
                postcode: a.postcode,
                country_id: a.country_id,
                telephone: a.telephone
            };
        },

        /**
         * Map a saved-address section record to the flat shape fillAddressForm expects.
         *
         * @param {Object} a
         * @return {Object}
         */
        normalizeSavedAddress: function (a) {
            return {
                firstname: a.firstname,
                lastname: a.lastname,
                company: a.company,
                street: a.street || [],
                city: a.city,
                region_id: a.region_id,
                region: a.region,
                postcode: a.postcode,
                country_id: a.country_id,
                telephone: a.telephone
            };
        },

        /* ---------------------------------------------------------------- prefill */

        /**
         * Guests only: restore the last-typed address from Magento's checkout-data (localStorage).
         * Logged-in shoppers are handled by initSavedAddresses() at first paint.
         */
        prefill: function () {
            if (window.isCustomerLoggedIn) {
                return;
            }
            var stored;
            try {
                stored = this.m.checkoutData.getShippingAddressFromData();
            } catch (e) {
                stored = null;
            }
            if (stored) {
                this.fillAddressForm(stored);
            }
        },

        /**
         * Populate the instant address form from a flat address object (used by the guest prefill,
         * the saved-address picker, and Places autocomplete).
         *
         * @param {Object} stored
         */
        fillAddressForm: function (stored) {
            if (!stored) {
                return;
            }
            this.setInput('firstname', stored.firstname);
            this.setInput('lastname', stored.lastname);
            this.setInput('company', stored.company);
            if (stored.street) {
                this.setInput('street[0]', stored.street[0]);
                this.setInput('street[1]', stored.street[1]);
            }
            this.setInput('city', stored.city);
            this.setInput('postcode', stored.postcode);
            this.setInput('telephone', stored.telephone);
            if (stored.country_id && this.el.country) {
                this.el.country.value = stored.country_id;
                this.renderRegionField(stored.country_id);
            }
            if (stored.region_id && this.el.regionSelect && !this.el.regionSelect.hidden) {
                this.el.regionSelect.value = stored.region_id;
            } else if (stored.region && this.el.regionInput) {
                this.el.regionInput.value = stored.region;
            }
        },

        /**
         * After the form is filled programmatically (picker/autocomplete): clear stale error flags,
         * refresh the shipping hint, and — once the live modules are loaded — sync the quote so
         * shipping rates estimate without the shopper touching a field.
         */
        afterAddressChanged: function () {
            this.clearFilledInvalidFlags();
            this.updateShippingHint();
            if (this.m) {
                this.syncAddress();
            }
        },

        /* ---------------------------------------------------------------- email */

        wireEmail: function () {
            var self = this;
            if (!this.el.email) {
                return;
            }
            var apply = function () {
                var email = self.el.email.value.trim();
                if (!email) {
                    return;
                }
                if (!window.isCustomerLoggedIn) {
                    self.m.quote.guestEmail = email;
                }
                try {
                    self.m.checkoutData.setInputFieldEmailValue(email);
                    self.m.checkoutData.setValidatedEmailValue(email);
                } catch (e) { /* non-fatal */ }
            };
            this.el.email.addEventListener('change', apply);
            this.el.email.addEventListener('blur', apply);
            // Apply immediately in case the field was pre-filled (autofill/back-navigation).
            apply();
        },

        /**
         * Adapt the form for virtual/downloadable carts: hide the shipping-method step (no
         * shipping) and relabel the address section as the billing address. The address is set
         * on the quote as billing in syncAddress().
         */
        configureForVirtual: function () {
            var root = this.root,
                methods = root.querySelector('[data-role="fastcheckout-shipping-methods"]'),
                heading = root.querySelector('[data-role="fastcheckout-shipping-address"] .fastcheckout-step-title');

            if (methods) {
                methods.hidden = true;
            }
            if (heading) {
                heading.textContent = heading.getAttribute('data-billing-label') || 'Billing Address';
            }
            root.classList.add('fc-virtual');
        },

        /* ---------------------------------------------------------------- address */

        wireAddress: function () {
            var self = this,
                sync = debounce(function () {
                    self.syncAddress();
                }, 500),
                hint = function () {
                    self.updateShippingHint();
                };

            // Immediate, friendly feedback on every keystroke; debounced quote sync + rates.
            this.el.form.addEventListener('input', function () { hint(); sync(); });
            this.el.form.addEventListener('change', function () { hint(); sync(); });
            this.el.form.addEventListener('blur', hint, true);
            if (this.el.email) {
                this.el.email.addEventListener('input', hint);
            }
            this.updateShippingHint();
        },

        /**
         * Return a friendly, specific message for the first missing required field, or null when
         * the address (and email) are complete enough to estimate shipping.
         *
         * @param {Object} data
         * @return {String|null}
         */
        getAddressValidationMessage: function (data) {
            var email = this.el.email ? this.el.email.value.trim() : '';

            if (!window.isCustomerLoggedIn && !email) {
                return 'Oops — you forgot your email address above.';
            }
            if (!data.firstname || !data.lastname) {
                return 'Please enter your first and last name above.';
            }
            if (!data.street[0]) {
                return 'Please enter your street address above.';
            }
            if (!data.city) {
                return 'Please add your city above.';
            }
            var regionRequired = this.requiredRegionCountries.indexOf(data.country_id) !== -1,
                hasRegion = (this.el.regionSelect && !this.el.regionSelect.hidden) ? !!data.region_id : true;

            if (regionRequired && !hasRegion) {
                return 'Please select your state/province above.';
            }
            if (!data.postcode) {
                return 'Please add your ZIP / postal code above.';
            }
            if (!data.country_id) {
                return 'Please select your country above.';
            }
            return null;
        },

        /**
         * Keep the shipping-method box explaining itself: what's missing, that rates are loading,
         * or that none are available. Skipped once real rates have rendered.
         */
        updateShippingHint: function () {
            if (this.isVirtual || !this.el.methods) {
                return;
            }
            var msg = this.getAddressValidationMessage(this.buildFlatData());

            if (msg) {
                // Address is incomplete: drop any stale rates and say exactly what's missing.
                this.rendered.rates = false;
                this.el.methods.innerHTML = '<p class="fastcheckout-hint">' + escapeHtml(msg) + '</p>';
                return;
            }
            // Complete but rates not shown yet → reassure while they load.
            if (!this.rendered.rates) {
                this.el.methods.innerHTML =
                    '<p class="fastcheckout-hint">' + escapeHtml('Finding your delivery options…') + '</p>';
            }
        },

        buildFlatData: function () {
            var get = this.getInput.bind(this),
                street0 = get('street[0]'),
                street1 = get('street[1]'),
                regionId = this.el.regionSelect && !this.el.regionSelect.hidden ? this.el.regionSelect.value : '',
                regionText = this.el.regionInput && !this.el.regionInput.hidden ? this.el.regionInput.value : '';

            return {
                firstname: get('firstname'),
                lastname: get('lastname'),
                company: get('company'),
                street: street1 ? { 0: street0, 1: street1 } : { 0: street0 },
                city: get('city'),
                region_id: regionId,
                region: regionText,
                postcode: get('postcode'),
                country_id: this.el.country ? this.el.country.value : '',
                telephone: get('telephone'),
                save_in_address_book: 0
            };
        },

        isAddressComplete: function (data) {
            var hasRegion = (this.el.regionSelect && !this.el.regionSelect.hidden)
                ? !!data.region_id
                : true; // free-text region is optional unless country requires it
            var regionRequired = this.requiredRegionCountries.indexOf(data.country_id) !== -1;

            return data.country_id &&
                data.postcode &&
                data.city &&
                data.street[0] &&
                data.firstname &&
                data.lastname &&
                (!regionRequired || hasRegion);
        },

        syncAddress: function () {
            if (!this.m) {
                return;
            }
            var data = this.buildFlatData();
            if (!this.isAddressComplete(data)) {
                return;
            }
            // createShippingAddress just converts flat form data into a quote address object
            // (it is address-type agnostic despite the name).
            if (this.isVirtual) {
                // Virtual cart: no shipping — this form IS the billing address, and the native
                // billing component is hidden, so set billing on the quote directly.
                this.m.quote.billingAddress(this.m.createShippingAddress(data));
                try {
                    this.m.checkoutData.setSelectedBillingAddress(this.m.quote.billingAddress().getKey());
                } catch (e) { /* non-fatal */ }
            } else {
                // Physical/mixed cart: set the shipping address (fires rate estimation). Billing
                // is handled by the native billing component's "same as shipping" default — we
                // do NOT set it manually here to avoid fighting that component.
                this.m.selectShippingAddress(this.m.createShippingAddress(data));
                try {
                    this.m.checkoutData.setShippingAddressFromData(data);
                } catch (e) { /* non-fatal */ }
            }
        },

        /* ---------------------------------------------------------------- rates */

        subscribeRates: function () {
            var self = this,
                ratesObs = this.m.shippingService.getShippingRates();

            this.renderRates(ratesObs());
            ratesObs.subscribe(function (rates) {
                self.renderRates(rates);
            });

            if (this.m.shippingService.isLoading) {
                this.m.shippingService.isLoading.subscribe(function (loading) {
                    self.root.classList.toggle('fc-rates-loading', !!loading);
                });
            }
        },

        renderRates: function (rates) {
            var self = this,
                box = this.el.methods;

            if (!box) {
                return;
            }
            if (!rates || !rates.length) {
                return; // still estimating — keep the current hint
            }

            // Rates came back but every one errored → tell the shopper plainly.
            var usable = rates.filter(function (r) { return !r.error_message; });
            if (!usable.length) {
                this.el.methods.innerHTML = '<p class="fastcheckout-hint">' +
                    escapeHtml('No delivery options are available for this address. Please check it and try again.') +
                    '</p>';
                return;
            }
            this.rendered.rates = true;

            // Build a parallel list of only the selectable (non-error) rates so the click
            // handler's index always aligns with the rendered radio inputs.
            var html = '',
                selectable = [];

            rates.forEach(function (rate) {
                if (rate.error_message) {
                    return;
                }
                var i = selectable.length,
                    id = 'fc-rate-' + i,
                    code = rate.carrier_code + '_' + rate.method_code;

                selectable.push(rate);
                html +=
                    '<label class="fc-rate" for="' + id + '">' +
                        '<input type="radio" name="fc-shipping-rate" id="' + id + '" value="' + escapeHtml(code) + '"/>' +
                        '<span class="fc-rate-title">' +
                            escapeHtml(rate.carrier_title || '') + ' - ' + escapeHtml(rate.method_title || '') +
                        '</span>' +
                        '<span class="fc-rate-price">' + self.formatPrice(rate.amount) + '</span>' +
                    '</label>';
            });
            box.innerHTML = html;

            box.querySelectorAll('input[name="fc-shipping-rate"]').forEach(function (input, i) {
                input.addEventListener('change', function () {
                    self.selectRate(selectable[i]);
                });
            });
        },

        selectRate: function (rate) {
            if (!rate) {
                return;
            }
            this.m.selectShippingMethod(rate);
            try {
                this.m.checkoutData.setSelectedShippingRate(rate.carrier_code + '_' + rate.method_code);
            } catch (e) { /* non-fatal */ }

            // Persist shipping selection + address to the quote so the payment island (and totals)
            // reflect the real order. This is the stock set-shipping-information REST call.
            var self = this;
            this.m.setShippingInformation().done(function () {
                self.root.classList.add('fc-shipping-set');
                self.forcePaymentVisible();
            });
        },

        /* ---------------------------------------------------------------- totals */

        subscribeTotals: function () {
            var self = this,
                totals = this.m.quote.totals;

            if (!totals) {
                return;
            }
            var apply = function (data) {
                self.quoteTotals = data;
                self.renderSummary(customerData.get('cart')());
            };
            if (totals()) {
                apply(totals());
            }
            totals.subscribe(apply);
        },

        /* ---------------------------------------------------------------- payment island */

        bootPaymentIsland: function () {
            var self = this,
                idle = window.requestIdleCallback || function (cb) { return window.setTimeout(cb, 1); };

            idle(function () {
                require(['ParkkTech_FastMagentoCheckout/js/view/payment-island'], function (paymentIsland) {
                    paymentIsland.boot();
                    self.forcePaymentVisible();
                });
            });
        },

        /**
         * Reveal the payment step. Stock checkout gates payment visibility on the step
         * navigator (activated when the shipping step completes); this single-page layout never
         * drives that, so the payment component stays hidden for non-virtual carts. Force it
         * visible once it registers.
         */
        forcePaymentVisible: function () {
            if (!this.m || !this.m.registry || !this.m.registry.get) {
                return;
            }
            var self = this,
                attempts = 0,
                hint = this.root.querySelector('[data-role="fc-payment-hint"]'),
                tick = function () {
                    var payment = self.m.registry.get('checkout.steps.billing-step.payment');

                    if (payment && payment.isVisible) {
                        payment.isVisible(true);
                    }
                    // Un-hide the ANCESTORS of each real payment method — defeats the step
                    // navigator's KO `visible` gating without revealing conditional content
                    // (collapsed billing form, empty express group, etc.).
                    var methods = self.root.querySelectorAll('#fastcheckout-payment .payment-method');

                    Array.prototype.forEach.call(methods, function (methodNode) {
                        var node = methodNode;
                        while (node && node.id !== 'fastcheckout-payment') {
                            if (node.style && node.style.display === 'none') {
                                node.style.display = '';
                            }
                            node = node.parentElement;
                        }
                    });

                    if (hint) {
                        hint.hidden = methods.length > 0;
                    }
                    if (attempts++ < 40) {
                        window.setTimeout(tick, 300);
                    }
                };

            tick();
        },

        /* ---------------------------------------------------------------- input helpers */

        getInput: function (name) {
            var node = this.el.form.querySelector('[name="' + name + '"]');
            return node ? node.value.trim() : '';
        },

        setInput: function (name, value) {
            if (value === undefined || value === null) {
                return;
            }
            var node = this.el.form.querySelector('[name="' + name + '"]');
            if (node) {
                node.value = value;
            }
        },

        /**
         * Format a numeric amount using Magento's own price formatting + the store priceFormat.
         *
         * @param {Number|String} amount
         * @return {String}
         */
        formatPrice: function (amount) {
            var value = parseFloat(amount || 0),
                format = (window.checkoutConfig && window.checkoutConfig.priceFormat) || {};

            if (this.m && this.m.priceUtils) {
                return this.m.priceUtils.formatPrice(value, format);
            }
            return value.toFixed(2);
        }
    };

    /* -------------------------------------------------------------------- utilities */

    function debounce(fn, wait) {
        var t;
        return function () {
            var ctx = this, args = arguments;
            window.clearTimeout(t);
            t = window.setTimeout(function () {
                fn.apply(ctx, args);
            }, wait);
        };
    }

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function totalRow(label, value, strong) {
        return '<div class="fc-total-row' + (strong ? ' fc-total-strong' : '') + '">' +
            '<span class="fc-total-label">' + escapeHtml(label) + '</span>' +
            '<span class="fc-total-value">' + escapeHtml(value) + '</span>' +
            '</div>';
    }

    // Same as totalRow but treats `value` as trusted, preformatted HTML (store-generated).
    function totalRowRaw(label, valueHtml) {
        return '<div class="fc-total-row">' +
            '<span class="fc-total-label">' + escapeHtml(label) + '</span>' +
            '<span class="fc-total-value">' + valueHtml + '</span>' +
            '</div>';
    }

    return function (config, element) {
        var node = element instanceof Element ? element : (element && element[0]) || document.getElementById('checkout');
        return new FastCheckout(config, node);
    };
});
