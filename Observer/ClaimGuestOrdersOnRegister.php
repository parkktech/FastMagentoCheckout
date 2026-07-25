<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\Observer;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Sales\Api\OrderRepositoryInterface;
use Magento\Sales\Model\Order\CustomerAssignment;
use Magento\Sales\Model\ResourceModel\Order\CollectionFactory as OrderCollectionFactory;
use Magento\Store\Model\ScopeInterface;
use Magento\Store\Model\StoreManagerInterface;
use Psr\Log\LoggerInterface;

/**
 * When a NEW account registers, retroactively attach every past guest order placed with that email
 * (in the same website) to the account — so their full order history is there the first time they
 * log in, even for orders made long before they registered.
 *
 * Complements LinkGuestOrderToCustomer (which links at place-time when the account already exists).
 * Gated by the same fastmagentocheckout/general/link_guest_orders flag (default ON).
 */
class ClaimGuestOrdersOnRegister implements ObserverInterface
{
    private const XML_PATH_ENABLED = 'fastmagentocheckout/general/link_guest_orders';

    /**
     * @var ScopeConfigInterface
     */
    private $scopeConfig;

    /**
     * @var OrderCollectionFactory
     */
    private $orderCollectionFactory;

    /**
     * @var OrderRepositoryInterface
     */
    private $orderRepository;

    /**
     * @var CustomerAssignment
     */
    private $customerAssignment;

    /**
     * @var StoreManagerInterface
     */
    private $storeManager;

    /**
     * @var LoggerInterface
     */
    private $logger;

    public function __construct(
        ScopeConfigInterface $scopeConfig,
        OrderCollectionFactory $orderCollectionFactory,
        OrderRepositoryInterface $orderRepository,
        CustomerAssignment $customerAssignment,
        StoreManagerInterface $storeManager,
        LoggerInterface $logger
    ) {
        $this->scopeConfig = $scopeConfig;
        $this->orderCollectionFactory = $orderCollectionFactory;
        $this->orderRepository = $orderRepository;
        $this->customerAssignment = $customerAssignment;
        $this->storeManager = $storeManager;
        $this->logger = $logger;
    }

    /**
     * @param Observer $observer
     * @return void
     */
    public function execute(Observer $observer): void
    {
        /** @var \Magento\Customer\Api\Data\CustomerInterface|null $customer */
        $customer = $observer->getEvent()->getData('customer');
        if (!$customer || !$customer->getId() || !$customer->getEmail()) {
            return;
        }

        $storeId = $customer->getStoreId() !== null ? (int)$customer->getStoreId() : null;
        if (!$this->scopeConfig->isSetFlag(self::XML_PATH_ENABLED, ScopeInterface::SCOPE_STORE, $storeId)) {
            return;
        }

        try {
            $storeIds = $this->storeManager->getWebsite((int)$customer->getWebsiteId())->getStoreIds();
        } catch (\Throwable $e) {
            return;
        }
        if (!$storeIds) {
            return;
        }

        $collection = $this->orderCollectionFactory->create();
        $collection->addFieldToFilter('customer_email', $customer->getEmail());
        $collection->addFieldToFilter('customer_id', ['null' => true]);
        $collection->addFieldToFilter('store_id', ['in' => array_values($storeIds)]);

        $claimed = 0;
        foreach ($collection->getAllIds() as $orderId) {
            try {
                $order = $this->orderRepository->get((int)$orderId);
                if ($order->getCustomerId()) {
                    continue; // linked in the meantime
                }
                $this->customerAssignment->execute($order, $customer);
                $claimed++;
            } catch (\Throwable $e) {
                $this->logger->warning(
                    'FastMagentoCheckout: could not claim guest order ' . $orderId
                    . ' for customer ' . $customer->getId() . ': ' . $e->getMessage()
                );
            }
        }

        if ($claimed) {
            $this->logger->info(sprintf(
                'FastMagentoCheckout: linked %d past guest order(s) to new customer %d (%s).',
                $claimed,
                (int)$customer->getId(),
                $customer->getEmail()
            ));
        }
    }
}
