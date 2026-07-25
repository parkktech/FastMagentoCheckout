<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\Observer;

use Magento\Customer\Api\CustomerRepositoryInterface;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Framework\Exception\NoSuchEntityException;
use Magento\Store\Model\ScopeInterface;
use Psr\Log\LoggerInterface;

/**
 * When a guest places an order with an email that already belongs to a registered account (in the
 * same website), attach the order to that account so it shows in the customer's order history.
 *
 * Fires on sales_order_place_before, so the customer link is written as part of the normal order
 * save — no re-save. Gated by fastmagentocheckout/general/link_guest_orders (default ON). Only ever
 * promotes a guest order to a known account; it never changes an order that is already a customer's.
 */
class LinkGuestOrderToCustomer implements ObserverInterface
{
    private const XML_PATH_ENABLED = 'fastmagentocheckout/general/link_guest_orders';

    /**
     * @var ScopeConfigInterface
     */
    private $scopeConfig;

    /**
     * @var CustomerRepositoryInterface
     */
    private $customerRepository;

    /**
     * @var LoggerInterface
     */
    private $logger;

    public function __construct(
        ScopeConfigInterface $scopeConfig,
        CustomerRepositoryInterface $customerRepository,
        LoggerInterface $logger
    ) {
        $this->scopeConfig = $scopeConfig;
        $this->customerRepository = $customerRepository;
        $this->logger = $logger;
    }

    /**
     * @param Observer $observer
     * @return void
     */
    public function execute(Observer $observer): void
    {
        /** @var \Magento\Sales\Model\Order $order */
        $order = $observer->getEvent()->getData('order');
        if (!$order) {
            return;
        }

        // Already tied to an account, or not a guest order → nothing to do.
        if ($order->getCustomerId() || !$order->getCustomerIsGuest()) {
            return;
        }

        $storeId = (int)$order->getStoreId();
        if (!$this->scopeConfig->isSetFlag(self::XML_PATH_ENABLED, ScopeInterface::SCOPE_STORE, $storeId)) {
            return;
        }

        $email = $order->getCustomerEmail();
        if (!$email) {
            return;
        }

        $websiteId = (int)$order->getStore()->getWebsiteId();
        try {
            $customer = $this->customerRepository->get($email, $websiteId);
        } catch (NoSuchEntityException $e) {
            return; // No account with this email — leave it as a genuine guest order.
        } catch (\Throwable $e) {
            $this->logger->warning('FastMagentoCheckout: guest-order link lookup failed: ' . $e->getMessage());
            return;
        }

        if (!$customer || !$customer->getId()) {
            return;
        }

        $order->setCustomerId((int)$customer->getId());
        $order->setCustomerIsGuest(0);
        $order->setCustomerGroupId($customer->getGroupId());
        $order->setCustomerFirstname($customer->getFirstname());
        $order->setCustomerLastname($customer->getLastname());
        $order->setCustomerMiddlename($customer->getMiddlename());
        $order->setCustomerPrefix($customer->getPrefix());
        $order->setCustomerSuffix($customer->getSuffix());
    }
}
