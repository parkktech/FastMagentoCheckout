<h1 align="center">⚡🛒 FastMagento Checkout</h1>
<p align="center"><strong>The instant, cacheable, islands-architecture checkout for Magento&nbsp;2</strong><br/>
<em>Paints the moment the HTML lands. Types before the JavaScript finishes its coffee.</em></p>

<p align="center">
  <img alt="Magento" src="https://img.shields.io/badge/Magento-2.4.x-f46f25?logo=magento&logoColor=white"/>
  <img alt="PHP" src="https://img.shields.io/badge/PHP-8.1--8.3-777bb4?logo=php&logoColor=white"/>
  <img alt="Base Magento only" src="https://img.shields.io/badge/base%20Magento-no%20core%20patches-2ea44f"/>
  <img alt="Every gateway" src="https://img.shields.io/badge/payment%20methods-all%20of%20them-2ea44f"/>
  <img alt="Fails safe" src="https://img.shields.io/badge/fail--safe-stock%20checkout-2ea44f"/>
  <img alt="CSP" src="https://img.shields.io/badge/CSP%20whitelist-baked%20in-005EB8"/>
  <img alt="License" src="https://img.shields.io/badge/license-OSL--3.0%20%2F%20AFL--3.0-blue"/>
</p>

> 🐌➡️🚀 The Magento 2 onepage checkout has a dirty little secret: it isn't really "one page," it's
> "one giant blob of per-quote JSON your server sweats out **before the browser can paint a single
> input**." `window.checkoutConfig` shows up carrying every payment method, every totals breakdown,
> every region of every country — and until it arrives, your shopper stares at a spinner holding
> their credit card. FastMagento Checkout is what happened when we decided the shopper should be
> **typing their email while all that runs in the background.**

**What it is.** FastMagento Checkout re-architects the Magento checkout as **islands**: a static,
**instantly interactive** contact + shipping form (real inputs in the first HTML byte — no skeleton,
no spinner) surrounding the **stock Knockout payment component**, booted as an isolated island so
**every payment method you already have keeps working untouched** (Stripe, Braintree, PayPal, Klarna,
Amazon Pay, Vault, offline… plus ReCaptcha). The heavy per-quote `window.checkoutConfig` is
**deferred to an async endpoint** and hydrated in the background, so the shell can be cached and the
form is usable *immediately*. It runs on **base Magento** — no Hyvä, no Breeze, no theme surgery
required — and if anything so much as sneezes, it **fails safe to the stock checkout**.

## 🚀 Quick install

```bash
composer require parkktech/fastmagento-checkout:^1.0@beta   # beta channel (see note)
bin/magento module:enable ParkkTech_FastMagentoCheckout
bin/magento setup:upgrade
bin/magento setup:di:compile        # production mode only
bin/magento cache:flush
```

> ℹ️ **Currently in beta.** Until a stable `v1.0.0` is tagged, install from the beta channel with
> the `:^1.0@beta` constraint above (or set `"minimum-stability": "beta"` + `"prefer-stable": true`
> in your project's `composer.json`). Once `v1.0.0` ships, plain
> `composer require parkktech/fastmagento-checkout` will resolve it.

Then turn it on: **Stores → Configuration → ParkkTech → FastMagento Checkout → Checkout Style →
_Single-Page Instant_**. It ships **disabled by default** — installing it never changes your
checkout until you flip the switch. (Full options below.)

**Requirements:** Magento 2.4.6+, PHP 8.1+. That's it. No search engine, no special theme, no core patches.

## 🤝 The perfect pairing

FastMagento Checkout is a proud member of the **FastMagento** family and the natural other half of
its story:

> ### ⚡ [FastMagento](https://packagist.org/packages/parkktech/fastmagento) obliterates the **data cost**. FastMagento Checkout obliterates the **checkout wait.**

[**FastMagento**](https://github.com/parkktech/FastMagento) makes **OpenSearch the primary serving
layer** for Magento — catalog, category tree, PDP, search and layered navigation served in
milliseconds, MySQL still the source of truth, real product objects, FPC/Varnish-safe, on base
Magento. It even makes *add-to-cart* fast by killing the ~30× inventory-table loop.

Run them together and you've got the whole funnel covered:

| Stage | Native Magento | With the pair |
|---|---|---|
| Browse / search / PDP | thousands of EAV queries | **⚡ FastMagento** → 0 product/EAV SQL, millisecond pages |
| Add to cart | loops inventory tables ~30× | **⚡ FastMagento** → flat, can't oversell |
| **Checkout** | **spinner until `checkoutConfig` lands** | **🛒 FastMagento Checkout** → **instant paint, type immediately** |

They're independent — each is a standalone win — but together they're a **banger of a store**:
lightning data layer *and* a checkout that paints before your shopper can blink. 🎸

👉 **Get the other half:** `composer require parkktech/fastmagento`

## Why it exists (the honest origin story)

We had a store that was *fast everywhere except the last step*. Catalog flew, search was instant,
cart was flat — and then the shopper hit checkout and got the classic Magento **spinner of
contemplation** while the server assembled a wall of JSON. The frustrating part? **None of that JSON
is needed to let someone start typing their name.** The email field, the street, the city — those are
static. Only the payment methods and totals need the private per-quote config, and even those don't
need to block first paint.

So we split the checkout into **islands**: paint the static form instantly, boot the real payment
component as its own little app, and fetch the private config in the background. The result is a
checkout that *feels* like a well-built SPA while remaining **100% stock Magento payment code** —
because the fastest checkout is the one you don't have to babysit.

## Problems it solves (problem → solution)

- **Problem:** `window.checkoutConfig` blocks first paint; the shopper waits on a spinner to type an email.
  **Solution:** a **static, immediately-typeable** form ships in the first HTML byte; the heavy config loads async and hydrates in place.
- **Problem:** the private per-quote config makes the checkout page uncacheable.
  **Solution:** the shell carries only static markup + a tiny safe skeleton; the per-quote data is fetched from a dedicated endpoint → the shell is cache-friendly.
- **Problem:** custom checkouts break your payment methods and you re-integrate Stripe/PayPal/Braintree/ReCaptcha by hand.
  **Solution:** we **boot the real stock Knockout payment subtree** as an island — every installed method + ReCaptcha work **unchanged**, zero per-method code.
- **Problem:** logged-in shoppers re-type an address Magento already has, and fetching it hits the DB on every checkout.
  **Solution:** the address book rides in the **customer-data section (localStorage)** — the default address prefills and a **carousel** lets them pick another, with **no SQL on the checkout page.**
- **Problem:** shoppers don't know their postcode format / skip the region and rates never load.
  **Solution:** **Google Places autocomplete** on the street field fills city/state/ZIP/country (region dropdown matched for you) — CSP whitelist **baked into the module.**
- **Problem:** a guest orders today, registers next month, and their history is orphaned.
  **Solution:** guest orders **link to a matching account at place-time**, *and* a new registration **retroactively claims every past guest order** for that email.
- **Problem:** the order summary is a cramped text list with no images and no idea when to scroll.
  **Solution:** **product thumbnails** (configurable → chosen simple, parent fallback) and an items list that **scrolls at the smaller of your "max items" setting and the payment form's height.**
- **Problem:** autocomplete skips the state field and the shopper never notices until "Place Order" fails.
  **Solution:** **inline validation** flags empty required fields on blur *and* when they focus a later field, and the shipping box says exactly what's missing.
- **Problem:** you flip on a fancy checkout and pray it doesn't break on a bad day.
  **Solution:** **fail-safe by design** — an admin toggle, a per-request `?fastcheckout=0` kill-switch, and automatic redirect to stock checkout if the config can't load. No schema changes. Rollback is instant.

## ✨ Features

### 🏝️ Islands architecture — instant paint, stock payments
The contact + shipping form is plain, static HTML mounted by a vanilla-JS widget (runs identically
under stock Magento and Breeze). The **payment area is the real Magento Knockout component**, booted
into its own node via Magento's own `Magento_Ui/js/core/app`. You get an instant frontend *and* the
full, battle-tested payment stack — Braintree, Stripe, PayPal, Klarna, Amazon Pay, Vault, offline —
with **no per-method integration**.

### ⏳ Deferred `checkoutConfig` (the whole trick)
The private per-quote config is fetched from `fastcheckout/config` **after** first paint and
**deep-merged in place** into a tiny static skeleton — preserving object identity so eager
third-party modules (looking at you, Stripe minicart) that read `window.checkoutConfig` at eval time
don't throw. The shell has no private data inlined, so it's cache-friendly.

### 🏠 In-memory saved addresses + carousel (zero SQL on checkout)
Logged in? Your address book is delivered once via a **customer-data section** and cached in
**localStorage**. On checkout it prefills your **default** address (and email) and shows a swipeable
**carousel** of every saved address — plus a leading **"＋ New address"** card that clears the form
to type a fresh one. Picking a card repopulates *every* field, region dropdown included. The section
refreshes only on login / address change / order placed — so a returning shopper hits checkout with
**no per-visit database call.**

### 📍 Google Places address autocomplete
Start typing your street and pick a suggestion — city, state, ZIP and country fill themselves (the
region *dropdown* is matched by code, not just text). Reuses an existing store Google key if you have
one (e.g. Amasty Address Autocomplete) or takes its own. The Google Maps hosts are in a
**self-contained `csp_whitelist.xml`** shipped *with the module*, so it works even if your site has
no CSP module of its own.

### 🔗 Guest orders that find their home — in both directions
- **At checkout:** a guest whose email already belongs to an account → the order is **attached to that account** (so it shows in their history immediately).
- **At registration:** a brand-new account **retroactively claims every past guest order** placed with that email.

One toggle, on by default. (It links by email match without a login step — so it's a toggle, not a
mandate. Off = every guest order stays a guest.)

### 🧾 Order summary that earns its keep
Real **product thumbnails** (for configurables: the chosen simple's image, falling back to the
parent), tidy totals from the live quote, and an items list that **scrolls internally** once it
would either exceed your *Maximum Items to Display* setting **or** run past the bottom of the payment
form — whichever comes first. It never shoves your "Place Order" button off-screen.

### 🚦 Inline validation + honest hints
Empty required fields turn red on blur — and when you focus a *later* field, we flag the one your
browser's autofill quietly skipped. The shipping box tells you *exactly* what's missing ("Please
select your state above") instead of silently refusing to show rates.

### 🧩 Physical, virtual & mixed carts
Physical carts estimate rates the instant the address is complete and keep Magento's native
"same as shipping" billing toggle. Virtual/downloadable carts hide shipping and treat the form as
the billing address. Mixed carts do both. All three place real orders.

### 🎨 Theme-independent styling
Sizing is in **absolute px**, so it doesn't shrink into oblivion on Luma themes that set
`html { font-size: 62.5% }`. Palette is a clean slate + go-green accent; responsive down to phones.

## 🔧 Configuration

**Stores → Configuration → ParkkTech → FastMagento Checkout**

| Setting | Default | What it does |
|---|---|---|
| **Checkout Style** | Default (2-Step) | `Single-Page Instant` turns on the fast checkout. Ships **off** so installing changes nothing until you choose. |
| **Address Autocomplete → Enable** | Yes | Google Places suggestions on the street field. Only activates when a key resolves. |
| **Address Autocomplete → Google Maps API Key** | *(blank)* | Plain text (a client-side Maps key is public — restrict it in Google Cloud). Blank = reuse the Amasty Address Autocomplete key if present. |
| **Link Guest Orders to Existing Accounts** | Yes | Attach guest orders to a matching account at checkout, and claim past guest orders when that email registers. |

Per-request escape hatch: append **`?fastcheckout=0`** to `/checkout` to force the stock checkout for
that one request (handy for support and A/B sanity checks).

## 🛠️ How it works (for the curious)

```
                          ┌─────────────────────────────────────────────┐
  First HTML byte  ─────► │  Static contact + shipping form (typeable)   │  ← instant paint
                          │  Order summary (from customer-data cart)     │
                          └───────────────┬─────────────────────────────┘
                                          │  async, after paint
                                          ▼
                          GET fastcheckout/config  ──►  window.checkoutConfig
                                          │  deep-merge (identity-preserving)
                                          ▼
                          ┌─────────────────────────────────────────────┐
   Payment island ──────► │  Real Magento KO payment subtree, booted via │
                          │  Magento_Ui/js/core/app  (all gateways)      │
                          └─────────────────────────────────────────────┘
```

- **Kill-switch first.** Disabled or `?fastcheckout=0` → the template renders byte-for-byte stock onepage markup. The fast path is opt-in and reversible.
- **Address book in memory.** A `fastcheckout-customer` customer-data section carries the address book to localStorage; invalidated only on login/logout/address-save/order-success.
- **Order linking** runs on `sales_order_place_before` (place-time) and `customer_register_success` (retroactive) — registered **globally**, because Magento places orders through the Web API, not the frontend area.

## ❓ FAQ

**Does it replace my payment methods?** No. It boots the *real* Magento payment component — your
existing methods and ReCaptcha work exactly as they do on stock checkout.

**Do I need Hyvä or Breeze?** No. Base Magento Luma is fine. It also runs happily under Breeze.

**Is it safe to install on a live store?** Yes — it's **off by default**, makes **no schema/data
changes**, and fails safe to stock checkout. Turn it on when you're ready; turn it off instantly if
you're not.

**What if the async config fails?** After a couple of retries the shopper is transparently redirected
to the guaranteed-stock checkout. Nobody gets stranded.

**Does the saved-address feature hit the database on every checkout?** No — that's the point. It's
served from localStorage; the DB is touched only when the address book actually changes.

## ↩️ Rollback

Set **Checkout Style → Default (2-Step)**, or `bin/magento module:disable
ParkkTech_FastMagentoCheckout`. No schema or data changes were ever made.

## 📦 Also by ParkkTech

- ⚡ **[FastMagento](https://packagist.org/packages/parkktech/fastmagento)** — OpenSearch serving
  layer & large-catalog toolkit. The perfect pairing (see above). `composer require parkktech/fastmagento`

## 📄 License

OSL-3.0 / AFL-3.0. Built by [ParkkTech](http://parkktech.com/).
