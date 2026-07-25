<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\ViewModel;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\UrlInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Store\Model\ScopeInterface;

/**
 * View model that drives the deferred-config checkout template.
 *
 * Decides whether the async ("Fast") path is active and exposes the endpoint
 * that serves window.checkoutConfig. Kept intentionally dependency-light so the
 * template can fall straight back to stock rendering when disabled.
 */
class CheckoutBoot implements ArgumentInterface
{
    private const XML_PATH_ENABLED = 'fastmagentocheckout/general/enabled';

    /** Google Places address autocomplete. */
    private const XML_PATH_AUTOCOMPLETE_ENABLED = 'fastmagentocheckout/address_autocomplete/enabled';
    private const XML_PATH_AUTOCOMPLETE_KEY = 'fastmagentocheckout/address_autocomplete/google_api_key';

    /** Fallback key from the Amasty Address Autocomplete extension, if installed (plaintext). */
    private const XML_PATH_AMASTY_KEY = 'amasty_address_autocomplete/general/google_api_key';

    /** Stock "Maximum Number of Items to Display in Order Summary" (Stores > Config > Sales > Checkout). */
    private const XML_PATH_MAX_ITEMS = 'checkout/sidebar/max_items_display_count';

    /** Request flag that forces stock checkout (used by the JS fail-safe). */
    private const DISABLE_PARAM = 'fastcheckout';

    /**
     * @var ScopeConfigInterface
     */
    private $scopeConfig;

    /**
     * @var RequestInterface
     */
    private $request;

    /**
     * @var UrlInterface
     */
    private $url;

    public function __construct(
        ScopeConfigInterface $scopeConfig,
        RequestInterface $request,
        UrlInterface $url
    ) {
        $this->scopeConfig = $scopeConfig;
        $this->request = $request;
        $this->url = $url;
    }

    /**
     * Whether the async-config checkout is active for this request.
     *
     * Off if the admin toggle is off, or the request carries ?fastcheckout=0
     * (the client uses this to degrade gracefully to stock checkout).
     */
    public function isEnabled(): bool
    {
        if ((string)$this->request->getParam(self::DISABLE_PARAM) === '0') {
            return false;
        }

        return $this->scopeConfig->isSetFlag(
            self::XML_PATH_ENABLED,
            ScopeInterface::SCOPE_STORE
        );
    }

    /**
     * URL of the endpoint that returns window.checkoutConfig as JSON.
     */
    public function getConfigUrl(): string
    {
        return $this->url->getUrl('fastcheckout/config');
    }

    /**
     * URL to reload the current checkout in guaranteed-stock mode.
     */
    public function getFallbackUrl(): string
    {
        return $this->url->getUrl('checkout', [self::DISABLE_PARAM => 0]);
    }

    /**
     * Whether Google Places address autocomplete should run — the admin toggle is on AND a
     * usable API key was resolved. With no key it stays off and the form is a plain address form.
     */
    public function isAddressAutocompleteEnabled(): bool
    {
        return $this->scopeConfig->isSetFlag(
            self::XML_PATH_AUTOCOMPLETE_ENABLED,
            ScopeInterface::SCOPE_STORE
        ) && $this->getGoogleMapsApiKey() !== '';
    }

    /**
     * The Google Maps JavaScript API key for the Places autocomplete. Prefers this module's own
     * key; falls back to the Amasty Address Autocomplete key so an existing store key is reused
     * without re-entry. Both are plain text (a client-side Maps key is public). Returns '' when
     * none is configured.
     */
    public function getGoogleMapsApiKey(): string
    {
        $own = trim((string)$this->scopeConfig->getValue(
            self::XML_PATH_AUTOCOMPLETE_KEY,
            ScopeInterface::SCOPE_STORE
        ));
        if ($own !== '') {
            return $own;
        }

        return trim((string)$this->scopeConfig->getValue(
            self::XML_PATH_AMASTY_KEY,
            ScopeInterface::SCOPE_STORE
        ));
    }

    /**
     * Stock "Maximum Number of Items to Display in Order Summary" setting. The summary shows up to
     * this many items before it starts scrolling. Defaults to Magento's own default of 10.
     */
    public function getMaxItemsDisplayCount(): int
    {
        $value = (int)$this->scopeConfig->getValue(
            self::XML_PATH_MAX_ITEMS,
            ScopeInterface::SCOPE_STORE
        );

        return $value > 0 ? $value : 10;
    }
}
