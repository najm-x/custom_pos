from frappe import __version__ as frappe_version

app_name = "custom_pos"
app_title = "Custom POS"
app_publisher = "Custom"
app_description = "Custom Arabic POS App for ERPNext v16"
app_email = "admin@example.com"
app_license = "MIT"

# Include CSS & JS in desk
app_include_css = ["/assets/custom_pos/css/custom_pos.css"]
app_include_js = [
    "/assets/custom_pos/js/pos_utils.js",
    "/assets/custom_pos/js/pos_item_grid.js",
    "/assets/custom_pos/js/pos_cart.js",
    "/assets/custom_pos/js/pos_payment.js",
    "/assets/custom_pos/js/pos_app.js",
]

# Page whitelisting (already handled by page definition JSON)
# No overrides needed — all API calls go to erpnext.selling.page.point_of_sale.*
