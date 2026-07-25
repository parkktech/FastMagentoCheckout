<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\Plugin;

use Magento\Framework\App\RequestInterface;
use Magento\Framework\View\LayoutInterface;
use ParkkTech\FastMagentoCheckout\ViewModel\CheckoutBoot;

/**
 * Makes the checkout page FPC/Varnish-cacheable when the fast checkout is active.
 *
 * The stock checkout is marked uncacheable purely because it inlines the per-quote
 * window.checkoutConfig. Our shell defers that to an async endpoint and inlines only
 * store-static data, so the page body is identical for every shopper and safe to cache.
 * Rather than fight the `cacheable="false"` attribute on checkout.root (which cannot be
 * flipped via referenceBlock without losing the payment-module jsLayout merges), we flip the
 * page's cacheability at the source: Layout::isCacheable().
 *
 * Gated + reversible: only the checkout page, only when the admin flag is on and the request
 * is not the ?fastcheckout=0 kill-switch (both checked by CheckoutBoot::isEnabled()).
 */
class CheckoutCacheable
{
    /**
     * @var RequestInterface
     */
    private $request;

    /**
     * @var CheckoutBoot
     */
    private $checkoutBoot;

    public function __construct(
        RequestInterface $request,
        CheckoutBoot $checkoutBoot
    ) {
        $this->request = $request;
        $this->checkoutBoot = $checkoutBoot;
    }

    /**
     * @param LayoutInterface $subject
     * @param bool $result
     * @return bool
     */
    public function afterIsCacheable(LayoutInterface $subject, $result)
    {
        if ($result) {
            return true;
        }

        if ($this->request->getFullActionName() === 'checkout_index_index'
            && $this->checkoutBoot->isEnabled()
        ) {
            return true;
        }

        return $result;
    }
}
