<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\Model\Config\Source;

use Magento\Framework\Data\OptionSourceInterface;

/**
 * Admin choice of checkout style. The stored value doubles as the enable flag:
 *   0 = stock two-step Knockout checkout, 1 = single-page instant checkout.
 */
class CheckoutStyle implements OptionSourceInterface
{
    /**
     * @return array
     */
    public function toOptionArray()
    {
        return [
            ['value' => 0, 'label' => __('Default (2-Step Magento Checkout)')],
            ['value' => 1, 'label' => __('Single-Page Instant Checkout (load & populate)')],
        ];
    }
}
