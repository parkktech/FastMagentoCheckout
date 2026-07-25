<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\ViewModel;

use Magento\Directory\Model\ResourceModel\Country\CollectionFactory as CountryCollectionFactory;
use Magento\Directory\Model\ResourceModel\Region\CollectionFactory as RegionCollectionFactory;
use Magento\Directory\Helper\Data as DirectoryHelper;
use Magento\Framework\Serialize\Serializer\Json;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Store\Model\StoreManagerInterface;

/**
 * Supplies the store-STATIC directory data the checkout address form needs to be
 * interactive at first paint: country <option>s and a region map keyed by country.
 *
 * All of this is identical for every shopper, so it is safe to render into a
 * Varnish-cacheable page. The per-quote/private data never comes from here — it
 * arrives later via the async checkout-config endpoint and customer-data sections.
 */
class AddressForm implements ArgumentInterface
{
    /**
     * @var CountryCollectionFactory
     */
    private $countryCollectionFactory;

    /**
     * @var RegionCollectionFactory
     */
    private $regionCollectionFactory;

    /**
     * @var DirectoryHelper
     */
    private $directoryHelper;

    /**
     * @var Json
     */
    private $serializer;

    /**
     * @var StoreManagerInterface
     */
    private $storeManager;

    /**
     * @var array|null
     */
    private $regionMap;

    public function __construct(
        CountryCollectionFactory $countryCollectionFactory,
        RegionCollectionFactory $regionCollectionFactory,
        DirectoryHelper $directoryHelper,
        Json $serializer,
        StoreManagerInterface $storeManager
    ) {
        $this->countryCollectionFactory = $countryCollectionFactory;
        $this->regionCollectionFactory = $regionCollectionFactory;
        $this->directoryHelper = $directoryHelper;
        $this->serializer = $serializer;
        $this->storeManager = $storeManager;
    }

    /**
     * Allowed countries as [['value' => code, 'label' => name], ...] (locale-named, sorted).
     *
     * @return array
     */
    public function getCountryOptions(): array
    {
        return $this->countryCollectionFactory->create()
            ->loadByStore()
            ->toOptionArray(false);
    }

    /**
     * The store's default country id (e.g. "US"), for pre-selecting the country field.
     *
     * @return string
     */
    public function getDefaultCountry(): string
    {
        return (string)$this->directoryHelper->getDefaultCountry();
    }

    /**
     * Country codes that require a region/state selection.
     *
     * @return array
     */
    public function getCountriesWithRequiredRegion(): array
    {
        return $this->directoryHelper->getCountriesWithStatesRequired();
    }

    /**
     * Whether an optional region is still shown for countries that have regions but don't require them.
     *
     * @return bool
     */
    public function isShowNonRequiredRegion(): bool
    {
        return $this->directoryHelper->isShowNonRequiredState();
    }

    /**
     * Region map keyed by country id:
     *   { "US": [ { "id": "12", "code": "CA", "name": "California" }, ... ], ... }
     *
     * @return array
     */
    public function getRegionMap(): array
    {
        if ($this->regionMap !== null) {
            return $this->regionMap;
        }

        $map = [];
        $collection = $this->regionCollectionFactory->create()
            ->addAllowedCountriesFilter($this->storeManager->getStore()->getId());

        foreach ($collection as $region) {
            $countryId = $region->getCountryId();
            $map[$countryId][] = [
                'id' => (string)$region->getId(),
                'code' => (string)$region->getCode(),
                'name' => (string)($region->getName() ?: $region->getDefaultName()),
            ];
        }

        return $this->regionMap = $map;
    }

    /**
     * Region map serialized for a data-* attribute / inline JSON consumed by the form widget.
     *
     * @return string
     */
    public function getRegionMapJson(): string
    {
        return $this->serializer->serialize($this->getRegionMap());
    }
}
