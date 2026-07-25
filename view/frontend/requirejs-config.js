/**
 * Map the data-mage-init alias used by the instant checkout shell to the widget module.
 * The alias keeps the template markup terse (data-mage-init='{"fastCheckout": {...}}') and
 * resolves identically under Breeze's require shim and stock RequireJS.
 */
var config = {
    map: {
        '*': {
            fastCheckout: 'ParkkTech_FastMagentoCheckout/js/checkout'
        }
    }
};
