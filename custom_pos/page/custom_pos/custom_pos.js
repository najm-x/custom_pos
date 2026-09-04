// Custom POS - Page Bootstrap
// All logic lives in /public/js/pos_app.js (loaded via hooks.py app_include_js)

frappe.pages["custom_pos"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("نقطة البيع المخصصة"),
		single_column: true,
	});

	// Hide the standard page header toolbar to give POS full screen
	$(wrapper).find(".page-head").hide();

	const startApp = () => {
		if (typeof CustomPOSApp !== "undefined") {
			window._custom_pos_instance = new CustomPOSApp(wrapper);
			window._custom_pos_instance.init();
		} else {
			frappe.msgprint(__("Custom POS assets not loaded. Run: bench build --app custom_pos"));
		}
	};

	if (typeof CustomPOSApp !== "undefined") {
		startApp();
	} else {
		// Fallback: dynamically load assets if not yet injected into desk
		frappe.require(
			[
				"/assets/custom_pos/css/custom_pos.css",
				"/assets/custom_pos/js/pos_utils.js",
				"/assets/custom_pos/js/pos_item_grid.js",
				"/assets/custom_pos/js/pos_cart.js",
				"/assets/custom_pos/js/pos_payment.js",
				"/assets/custom_pos/js/pos_app.js",
			],
			startApp
		);
	}
};

frappe.pages["custom_pos"].on_page_show = function (wrapper) {
	$(wrapper).find(".page-head").hide();
	if (window._custom_pos_instance && window._custom_pos_instance.on_show) {
		window._custom_pos_instance.on_show();
	}
};
