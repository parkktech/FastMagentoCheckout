<?php
declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\Controller\Config;

use Magento\Checkout\Block\Onepage;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\JsonFactory;
use Magento\Framework\Controller\ResultInterface;
use Magento\Framework\View\LayoutInterface;
use Psr\Log\LoggerInterface;

/**
 * Serves window.checkoutConfig for the current quote as JSON.
 *
 * This is the async half of the deferred-config checkout: the page ships a
 * cacheable shell, then the browser fetches this endpoint to hydrate the
 * Knockout checkout. We build the real {@see Onepage} block and call
 * getCheckoutConfig() (rather than re-deriving the config) so that any
 * third-party plugins on that method continue to apply — the payload is
 * identical to what the stock template would have inlined.
 *
 * The response is per-session and private, so it is explicitly never cached.
 */
class Index implements HttpGetActionInterface
{
    /**
     * @var JsonFactory
     */
    private $resultJsonFactory;

    /**
     * @var LayoutInterface
     */
    private $layout;

    /**
     * @var LoggerInterface
     */
    private $logger;

    public function __construct(
        JsonFactory $resultJsonFactory,
        LayoutInterface $layout,
        LoggerInterface $logger
    ) {
        $this->resultJsonFactory = $resultJsonFactory;
        $this->layout = $layout;
        $this->logger = $logger;
    }

    /**
     * @return ResultInterface
     */
    public function execute()
    {
        $result = $this->resultJsonFactory->create();
        // Per-session, per-quote data — must never be stored by browser, proxy or CDN.
        $result->setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0', true);
        $result->setHeader('Pragma', 'no-cache', true);

        try {
            /** @var Onepage $block */
            $block = $this->layout->createBlock(Onepage::class);
            $result->setData($block->getCheckoutConfig());
        } catch (\Throwable $e) {
            // Never leak a partial/invalid config: signal failure so the client
            // degrades to stock checkout instead of booting on bad data.
            $this->logger->critical(
                'FastMagentoCheckout: failed to build checkout config: ' . $e->getMessage(),
                ['exception' => $e]
            );
            $result->setHttpResponseCode(500);
            $result->setData(['error' => true]);
        }

        return $result;
    }
}
