// ============================================================
//  Custom POS — Main Controller
//  pos_app.js  (loaded last via hooks.py)
// ============================================================

class CustomPOSApp {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.$container = null;
		this.posProfile = null;
		this.openingEntry = null;

		// Sub-components (set after renderUI)
		this.grid = null;
		this.cart = null;
		this.payment = null;

		// Lifecycle guard flags
		this.isInitializing = false;
		this.isInitialized = false;
	}

	// ── Entry Point ────────────────────────────────────────────

	async init() {
		if (this.isInitializing || this.isInitialized) return;
		this.isInitializing = true;
		try {
			this._buildContainer();
			await this.checkOpeningEntry();
		} finally {
			this.isInitializing = false;
		}
	}

	_buildContainer() {
		// Clear wrapper and inject our POS shell
		$(this.wrapper).find(".layout-main-section").empty();
		this.$container = $('<div class="pos-app-wrapper" dir="rtl"></div>');
		$(this.wrapper).find(".layout-main-section").append(this.$container);
	}

	// ── Opening Entry ──────────────────────────────────────────

	async checkOpeningEntry() {
		frappe.show_progress(__("جارٍ التحقق من الجلسة..."), 10, 100);

		try {
			const r = await frappe.call({
				method: "erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry",
				args: { user: frappe.session.user },
			});

			frappe.hide_progress();

			if (r.message && r.message.length) {
				this.openingEntry = r.message[0];
				await this.loadPosProfile(this.openingEntry.pos_profile);
				this.renderUI();
			} else {
				this.showOpeningEntryDialog();
			}
		} catch (err) {
			frappe.hide_progress();
			console.error("Custom POS: check_opening_entry failed", err);
			POSUtils.alert(__("تعذّر التحقق من الجلسة. تأكد من إعداد POS Profile."), "red");
		}
	}

	async loadPosProfile(profileName) {
		frappe.show_progress(__("جارٍ تحميل إعدادات POS..."), 50, 100);
		const r = await frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_pos_profile_data",
			args: { pos_profile: profileName },
		});
		frappe.hide_progress();
		this.posProfile = r.message;
	}

	// ── Opening Entry Dialog ───────────────────────────────────

	showOpeningEntryDialog() {
		// Remove existing overlay if any
		$("#pos-opening-overlay").remove();

		// First, get available POS Profiles for this user
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "POS Profile",
				filters: [["disabled", "=", 0]],
				fields: ["name", "company"],
				page_length: 50,
			},
			callback: (r) => {
				const profiles = r.message || [];
				if (!profiles.length) {
					POSUtils.alert(
						__("لا يوجد POS Profile متاح. يرجى إعداد POS Profile من لوحة التحكم أولاً."),
						"red"
					);
					return;
				}
				this._renderOpeningDialog(profiles);
			},
		});
	}

	_renderOpeningDialog(profiles) {
		const profileOptions = profiles
			.map((p) => `<option value="${p.name}" data-company="${p.company}">${p.name}</option>`)
			.join("");

		const overlay = $(`
			<div class="pos-opening-overlay" id="pos-opening-overlay">
				<div class="pos-opening-dialog">
					<h3>🏪 ${__("فتح جلسة POS")}</h3>

					<div class="pos-field-row">
						<label>${__("الشركة")}</label>
						<input type="text" id="pos-open-company" value="${frappe.defaults.get_default("company") || ""}" readonly>
					</div>

					<div class="pos-field-row">
						<label>${__("POS Profile")} *</label>
						<select id="pos-open-profile" required>
							<option value="">${__("اختر POS Profile...")}</option>
							${profileOptions}
						</select>
					</div>

					<div class="pos-field-row">
						<label>${__("تفاصيل الرصيد الافتتاحي")}</label>
						<table class="pos-opening-balance-table" id="pos-balance-table">
							<thead>
								<tr>
									<th>${__("وسيلة الدفع")}</th>
									<th>${__("المبلغ الافتتاحي")}</th>
								</tr>
							</thead>
							<tbody id="pos-balance-rows">
								<tr>
									<td colspan="2" style="text-align:center; color:#9ca3af;">
										${__("اختر POS Profile أولاً")}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<button class="pos-btn-open-session" id="pos-btn-open-session">
						${__("فتح الجلسة")}
					</button>
				</div>
			</div>
		`);

		$("body").append(overlay);

		// When profile changes, load its payment methods
		overlay.find("#pos-open-profile").on("change", (e) => {
			const profile = e.target.value;
			const company = $(e.target).find("option:selected").data("company");
			overlay.find("#pos-open-company").val(company || "");
			this._loadOpeningBalanceRows(profile, overlay);
		});

		// If there is only 1 profile available, auto-select it
		if (profiles.length === 1) {
			overlay.find("#pos-open-profile").val(profiles[0].name).trigger("change");
		}

		// Submit
		overlay.find("#pos-btn-open-session").on("click", () => {
			this._submitOpeningEntry(overlay);
		});
	}

	_loadOpeningBalanceRows(posProfile, overlay) {
		if (!posProfile) return;
		frappe.db.get_doc("POS Profile", posProfile).then((doc) => {
			const payments = doc.payments || [];
			const $tbody = overlay.find("#pos-balance-rows");
			if (!payments.length) {
				$tbody.html(
					`<tr><td colspan="2" style="text-align:center; color:#9ca3af;">
						${__("لا توجد وسائل دفع في هذا الـ POS Profile")}
					</td></tr>`
				);
				return;
			}
			$tbody.html(
				payments
					.map(
						(p) => `
					<tr data-mop="${p.mode_of_payment}">
						<td>${p.mode_of_payment}</td>
						<td>
							<input type="number" class="pos-balance-amount"
								data-mop="${p.mode_of_payment}"
								value="0" min="0" step="0.01" style="width:100%;border:none;padding:4px 6px;">
						</td>
					</tr>`
					)
					.join("")
			);
		});
	}

	async _submitOpeningEntry(overlay) {
		const posProfile = overlay.find("#pos-open-profile").val();
		const company = overlay.find("#pos-open-company").val();

		if (!posProfile) {
			POSUtils.alert(__("يرجى اختيار POS Profile"), "red");
			return;
		}
		if (!company) {
			POSUtils.alert(__("يرجى تحديد الشركة"), "red");
			return;
		}

		const balanceDetails = [];
		overlay.find(".pos-balance-amount").each(function () {
			const mop = $(this).data("mop");
			const amount = POSUtils.flt($(this).val());
			if (mop) balanceDetails.push({ mode_of_payment: mop, opening_amount: amount });
		});

		if (!balanceDetails.length) {
			POSUtils.alert(__("يرجى إضافة وسائل الدفع والرصيد الافتتاحي"), "red");
			return;
		}

		const $btn = overlay.find("#pos-btn-open-session");
		$btn.prop("disabled", true).text(__("جارٍ الفتح..."));

		try {
			const r = await frappe.call({
				method: "erpnext.selling.page.point_of_sale.point_of_sale.create_opening_voucher",
				args: {
					pos_profile: posProfile,
					company,
					balance_details: JSON.stringify(balanceDetails),
				},
			});

			overlay.remove();
			this.openingEntry = r.message;
			POSUtils.alert(__("تم فتح الجلسة بنجاح"), "green");
			await this.loadPosProfile(posProfile);
			this.renderUI();
		} catch (err) {
			console.error("Custom POS: create_opening_voucher failed", err);
			const errMsg = POSUtils.get(err, "message") || __("حدث خطأ أثناء فتح الجلسة");
			POSUtils.alert(errMsg, "red");
			$btn.prop("disabled", false).text(__("فتح الجلسة"));
		}
	}

	// ── Render Main UI ─────────────────────────────────────────

	renderUI() {
		this.$container.empty();

		// Instantiate components
		this.grid    = new POSItemGrid(this);
		this.cart    = new POSCart(this);
		this.payment = new POSPayment(this);

		// Render in order (RTL: cart on right → products on left)
		this.cart.render();
		this.grid.render();

		// Set default customer from POS Profile if configured
		if (this.posProfile && this.posProfile.customer) {
			this.cart.setCustomer(this.posProfile.customer, this.posProfile.customer);
			this.grid.$wrapper.find("#pos-customer-input").val(this.posProfile.customer);
		}

		// Load items
		this.grid.loadItems();

		// Update suspend badge
		const suspended = POSUtils.storage.getAll();
		this.grid.updateSuspendBadge(suspended.length);

		this.isInitialized = true;
	}

	// ── Page Show (when navigating back to page) ───────────────
	on_show() {
		// Prevent re-running if already initializing or already initialized
		if (this.isInitializing || this.isInitialized || this.posProfile) return;
		this.checkOpeningEntry();
	}
}

window.CustomPOSApp = CustomPOSApp;
