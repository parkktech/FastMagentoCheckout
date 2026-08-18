<?php

declare(strict_types=1);

namespace ParkkTech\FastMagentoCheckout\Plugin;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\View\Asset\Repository as AssetRepository;
use Magento\Framework\View\Design\Theme\ThemeProviderInterface;
use Magento\Framework\View\DesignInterface;
use Magento\Store\Model\ScopeInterface;
use Magento\Theme\Block\Html\Header\Logo;

/**
 * Carry the storefront's logo onto the checkout when theme fallback has swapped the theme.
 *
 * Hyva_ThemeFallback renders /checkout/index in a different theme from the rest of the storefront
 * (Magento/luma by default). Magento's logo block only reaches for a theme asset as a LAST resort:
 *
 *     design/header/logo_src (an uploaded file under pub/media/logo)   <- theme-independent
 *     -> getLogoFile()
 *     -> getViewFileUrl('images/logo.svg')                             <- the CURRENT theme's asset
 *
 * A store that has never uploaded a logo therefore falls through to that last line, which resolves
 * against whatever theme is rendering — so the shopper sees the storefront theme's logo everywhere
 * and then the fallback theme's stock logo at checkout. On a Breeze storefront that is a literal
 * "BREEZE" wordmark on every page and a "LUMA" one at the moment of payment.
 *
 * The wrong fix is to upload a logo and let it override every theme: that makes checkout match by
 * taking the storefront's own branding away from it. The right fix is what this does — resolve the
 * SAME asset path against the theme the store is actually configured to use, so the fallback theme
 * borrows the storefront's logo and nothing else changes.
 *
 * Deliberately does nothing when:
 *  - a logo has been uploaded (design/header/logo_src) — that already works across themes, and the
 *    merchant's explicit choice outranks ours;
 *  - no theme swap is in play (the configured theme is the one rendering);
 *  - the configured theme has no logo of its own to lend.
 */
class HeaderLogoThemePlugin
{
    public function __construct(
        private readonly ScopeConfigInterface $scopeConfig,
        private readonly DesignInterface $design,
        private readonly ThemeProviderInterface $themeProvider,
        private readonly AssetRepository $assetRepository
    ) {
    }

    /**
     * @param string $result
     * @return string
     */
    public function afterGetLogoSrc(Logo $subject, $result)
    {
        // An uploaded logo is already theme-independent — leave it alone.
        if ($this->scopeConfig->getValue('design/header/logo_src', ScopeInterface::SCOPE_STORE)) {
            return $result;
        }

        try {
            $configuredId = $this->scopeConfig->getValue(
                DesignInterface::XML_PATH_THEME_ID,
                ScopeInterface::SCOPE_STORE
            );
            if (!$configuredId) {
                return $result;
            }

            $current = $this->design->getDesignTheme();
            if ($current && (string) $current->getId() === (string) $configuredId) {
                return $result; // no swap in play
            }

            $configured = $this->themeProvider->getThemeById((int) $configuredId);
            $themePath = $configured ? $configured->getThemePath() : null;
            if (!$themePath) {
                return $result;
            }

            $logo = $this->assetRepository->createAsset(
                'images/logo.svg',
                ['area' => 'frontend', 'theme' => $themePath]
            );

            // Only borrow it if that theme actually ships one.
            return $logo->getSourceFile() ? $logo->getUrl() : $result;
        } catch (\Throwable $e) {
            // Never let a logo lookup break the checkout.
            return $result;
        }
    }
}
