<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\CustomerData;

use Magento\Customer\CustomerData\SectionSourceInterface;
use Magento\Customer\Helper\Session\CurrentCustomer;

/**
 * Customer-data section that puts the logged-in customer's address book into browser localStorage.
 *
 * This runs its DB read only when the section is (re)loaded — i.e. on login / address save / order
 * placement (see etc/frontend/sections.xml) — NOT on every checkout visit. The checkout widget then
 * reads the addresses straight from localStorage, so the instant checkout prefills the default
 * address and offers the saved-address picker with ZERO server/SQL calls on the checkout page.
 */
class CheckoutAddresses implements SectionSourceInterface
{
    /**
     * @var CurrentCustomer
     */
    private $currentCustomer;

    public function __construct(CurrentCustomer $currentCustomer)
    {
        $this->currentCustomer = $currentCustomer;
    }

    /**
     * @inheritDoc
     */
    public function getSectionData()
    {
        if (!$this->currentCustomer->getCustomerId()) {
            return ['isLoggedIn' => false, 'addresses' => []];
        }

        $customer = $this->currentCustomer->getCustomer();
        $defaultShipping = (string)$customer->getDefaultShipping();
        $defaultBilling = (string)$customer->getDefaultBilling();
        $addresses = [];

        foreach ((array)$customer->getAddresses() as $address) {
            $id = (string)$address->getId();
            if ($id === '') {
                continue;
            }
            $region = $address->getRegion();
            $street = $address->getStreet() ?: [];

            $addresses[$id] = [
                'id' => $id,
                'firstname' => (string)$address->getFirstname(),
                'lastname' => (string)$address->getLastname(),
                'company' => (string)$address->getCompany(),
                'street' => array_values($street),
                'city' => (string)$address->getCity(),
                'region' => $region ? (string)$region->getRegion() : '',
                'region_id' => $region && $region->getRegionId() ? (string)$region->getRegionId() : '',
                'region_code' => $region ? (string)$region->getRegionCode() : '',
                'postcode' => (string)$address->getPostcode(),
                'country_id' => (string)$address->getCountryId(),
                'telephone' => (string)$address->getTelephone(),
                'default_shipping' => $id === $defaultShipping,
                'default_billing' => $id === $defaultBilling,
                'label' => $this->buildLabel($address),
            ];
        }

        return [
            'isLoggedIn' => true,
            'email' => (string)$customer->getEmail(),
            'default_shipping' => $defaultShipping,
            'default_billing' => $defaultBilling,
            'addresses' => $addresses,
        ];
    }

    /**
     * A short, human-readable label for the address picker dropdown.
     *
     * @param \Magento\Customer\Api\Data\AddressInterface $address
     * @return string
     */
    private function buildLabel($address): string
    {
        $street = $address->getStreet() ?: [];
        $line = implode(' ', array_values($street));
        $name = trim($address->getFirstname() . ' ' . $address->getLastname());
        $place = trim($line . ($address->getCity() ? ', ' . $address->getCity() : ''));

        return trim($name . ($place ? ' — ' . $place : ''));
    }
}
