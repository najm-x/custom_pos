// ============================================================
//  Custom POS — Payment Component
//  pos_payment.js
// ============================================================

class POSPayment {
	constructor(app) {
		this.app = app;
		this.$modal = null;
		this.grandTotal = 0;
	}

	// ── Show Modal ─────────────────────────────────────────────

	show(grandTotal) {
		this.grandTotal = grandTotal;
		this._removeModal();
		this._buildModal();
	}

	_buildModal() {
		const currency = this.app.posProfile.currency;
		const payments = this.app.posProfile.payments || [];
		const defaultMethod = this.app.cart.selectedPayment || (payments[0] && payments[0].mode_of_payment) || "";

		const methodOptions = payments.map((p) => `
			<option value="${p.mode_of_payment}" ${p.mode_of_payment === defaultMethod ? "selected" : ""}>
				${p.mode_of_payment}
			</option>
		`).join("");

		const $overlay = $(`
			<div class="pos-payment-modal-overlay" id="pos-pay-overlay">
				<div class="pos-payment-modal">
					<h3>💳 ${__("إتمام الدفع")}</h3>

					<div class="pos-modal-total" id="pos-modal-total">
						${POSUtils.formatCurrency(this.grandTotal, currency)}
					</div>

					<div class="pos-modal-row">
						<label>${__("وسيلة الدفع")}</label>
						<select id="pos-modal-method" class="pos-payment-select" style="flex:1; max-width:180px;">
							${methodOptions}
						</select>
					</div>

					<div class="pos-modal-row">
						<label>${__("المبلغ المدفوع")}</label>
						<input type="number" id="pos-modal-tendered" class="pos-modal-input"
							value="${this.grandTotal.toFixed(2)}" min="0" step="0.01" autofocus>
					</div>

					<div class="pos-change-row" id="pos-change-row">
						<span>${__("الباقي / الزيادة")}</span>
						<span id="pos-change-val">${POSUtils.formatCurrency(0, currency)}</span>
					</div>

					<div class="pos-modal-actions">
						<button class="pos-btn-cancel" id="pos-pay-cancel">${__("إلغاء")}</button>
						<button class="pos-btn-confirm" id="pos-pay-confirm">
							✔ ${__("تأكيد وترحيل")}
						</button>
					</div>
				</div>
			</div>
		`);

		$("body").append($overlay);
		this.$modal = $overlay;

		// Focus the tendered input
		setTimeout(() => $overlay.find("#pos-modal-tendered").focus().select(), 100);

		// Live change calculation
		$overlay.find("#pos-modal-tendered").on("input", () => this._calcChange());

		// Cancel
		$overlay.find("#pos-pay-cancel").on("click", () => this._removeModal());

		// Close on overlay click
		$overlay.on("click", (e) => {
			if ($(e.target).is("#pos-pay-overlay")) this._removeModal();
		});

		// Confirm
		$overlay.find("#pos-pay-confirm").on("click", () => this._confirm());

		// Enter key = confirm
		$overlay.on("keydown", (e) => {
			if (e.key === "Enter") this._confirm();
			if (e.key === "Escape") this._removeModal();
		});
	}

	_calcChange() {
		const tendered = POSUtils.flt(this.$modal.find("#pos-modal-tendered").val());
		const change = tendered - this.grandTotal;
		const currency = this.app.posProfile.currency;
		const $changeRow = this.$modal.find("#pos-change-row");
		const $val = this.$modal.find("#pos-change-val");

		$val.text(POSUtils.formatCurrency(Math.abs(change), currency));

		if (change < 0) {
			$changeRow.css({ background: "#fff1f2", borderColor: "#fca5a5", color: "#dc2626" });
			this.$modal.find("#pos-change-row span:first").text(__("ناقص"));
		} else {
			$changeRow.css({ background: "#f0fdf4", borderColor: "#86efac", color: "#10b981" });
			this.$modal.find("#pos-change-row span:first").text(__("الباقي / الزيادة"));
		}
	}

	_removeModal() {
		if (this.$modal) {
			this.$modal.remove();
			this.$modal = null;
		}
	}

	// ── Submit Invoice ─────────────────────────────────────────

	async _confirm() {
		const customerName = this.app.cart.customer?.name || this.app.posProfile?.customer;
		if (!customerName) {
			POSUtils.alert(__("يرجى تحديد العميل أولاً"), "red");
			return;
		}

		const tendered = POSUtils.flt(this.$modal.find("#pos-modal-tendered").val());
		if (tendered <= 0) {
			POSUtils.alert(__("يرجى إدخال المبلغ المدفوع"), "red");
			return;
		}
		if (tendered < this.grandTotal) {
			POSUtils.alert(__("المبلغ المدفوع أقل من الإجمالي المطلوب"), "red");
			return;
		}

		const method = this.$modal.find("#pos-modal-method").val();
		if (!method) {
			POSUtils.alert(__("يرجى اختيار وسيلة الدفع"), "red");
			return;
		}

		// Disable confirm button to prevent double-submit
		this.$modal.find("#pos-pay-confirm")
			.prop("disabled", true)
			.text(__("جارٍ الترحيل..."));

		await this._submitInvoice(method, tendered);
	}

	async _submitInvoice(method, tendered) {
		try {
			const invoiceDoc = this._buildInvoiceDoc(method, tendered);

			// Step 1: Save draft
			frappe.show_progress(__("جارٍ حفظ الفاتورة..."), 30, 100);
			let saveRes = await frappe.call({
				method: "frappe.client.save",
				args: { doc: invoiceDoc },
			});

			if (!saveRes.message) throw new Error("Save failed");
			let savedDoc = saveRes.message;

			// Reconcile payments with actual backend grand total (taxes/charges adjustment)
			const actualGrandTotal = POSUtils.flt(savedDoc.grand_total);
			const actualTendered = Math.max(tendered, actualGrandTotal);
			let paymentsUpdated = false;

			if (savedDoc.payments && savedDoc.payments.length) {
				savedDoc.payments.forEach((p) => {
					if (p.mode_of_payment === method) {
						if (p.amount !== actualTendered) {
							p.amount = actualTendered;
							paymentsUpdated = true;
						}
					}
				});
			}

			if (paymentsUpdated) {
				saveRes = await frappe.call({
					method: "frappe.client.save",
					args: { doc: savedDoc },
				});
				savedDoc = saveRes.message;
			}

			// Step 2: Submit
			frappe.show_progress(__("جارٍ ترحيل الفاتورة..."), 70, 100);
			const submitRes = await frappe.call({
				method: "frappe.client.submit",
				args: { doc: savedDoc },
			});

			frappe.hide_progress();

			if (submitRes.message && submitRes.message.name) {
				this._onSuccess(submitRes.message, tendered);
			} else {
				throw new Error("Submit returned no document");
			}
		} catch (err) {
			frappe.hide_progress();
			console.error("Custom POS: Invoice submit error", err);
			let errMsg = __("حدث خطأ أثناء الترحيل");
			if (err._server_messages) {
				try {
					const msgs = JSON.parse(err._server_messages);
					const parsed = JSON.parse(msgs[0]);
					errMsg = parsed.message || msgs[0];
				} catch {
					errMsg = err.message || errMsg;
				}
			} else if (err.message) {
				errMsg = err.message;
			}
			POSUtils.alert(errMsg, "red");

			// Re-enable confirm button
			if (this.$modal) {
				this.$modal.find("#pos-pay-confirm")
					.prop("disabled", false)
					.text(`✔ ${__("تأكيد وترحيل")}`);
			}
		}
	}

	_buildInvoiceDoc(method, tendered) {
		const cart = this.app.cart;
		const profile = this.app.posProfile;
		const customerName = cart.customer ? cart.customer.name : profile.customer;

		const items = cart.items.map((item) => ({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.qty,
			uom: item.uom,
			stock_uom: item.stock_uom || item.uom,
			conversion_factor: item.conversion_factor || 1,
			rate: item.rate,
			amount: item.qty * item.rate,
			serial_no: item.serial_no || "",
			batch_no: item.batch_no || "",
			warehouse: profile.warehouse || "",
		}));

		const paymentRow = {
			mode_of_payment: method,
			amount: Math.max(tendered, this.grandTotal),
		};
		const account = this._getPaymentAccount(method);
		if (account) paymentRow.account = account;

		return {
			doctype: "POS Invoice",
			is_pos: 1,
			update_stock: 1,
			posting_date: frappe.datetime?.now_date ? frappe.datetime.now_date() : undefined,
			posting_time: frappe.datetime?.now_time ? frappe.datetime.now_time() : undefined,
			pos_profile: profile.name,
			company: profile.company,
			currency: profile.currency,
			conversion_rate: profile.conversion_rate || 1,
			selling_price_list: profile.selling_price_list,
			price_list_currency: profile.currency,
			plc_conversion_rate: 1,
			customer: customerName,
			customer_name: cart.customer ? cart.customer.display_name : customerName,
			set_warehouse: profile.warehouse || "",
			items,
			payments: [paymentRow],
			discount_amount: cart.discount || 0,
			additional_discount_percentage: 0,
			taxes_and_charges: profile.taxes_and_charges || "",
			pos_opening_entry: this.app.openingEntry ? this.app.openingEntry.name : "",
		};
	}

	_getPaymentAccount(method) {
		const payments = this.app.posProfile.payments || [];
		const found = payments.find((p) => p.mode_of_payment === method);
		return (found && found.default_account) ? found.default_account : "";
	}

	// ── Success Handler ────────────────────────────────────────

	_onSuccess(invoiceDoc, tendered) {
		const change = tendered - this.grandTotal;
		const currency = this.app.posProfile.currency;

		this._removeModal();

		// Success dialog with receipt option
		const successDialog = new frappe.ui.Dialog({
			title: `✅ ${__("تم الترحيل بنجاح")}`,
			fields: [
				{
					fieldtype: "HTML",
					options: `
						<div style="text-align:center; padding: 20px 0; direction: rtl;">
							<div style="font-size: 48px; margin-bottom: 16px;">✅</div>
							<div style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #10b981;">
								${__("تم إتمام البيع بنجاح")}
							</div>
							<div style="font-size: 14px; color: #6b7280; margin-bottom: 16px;">
								${__("رقم الفاتورة")}: <strong>${invoiceDoc.name}</strong>
							</div>
							<div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 20px; display: inline-block;">
								<div style="font-size: 13px; color: #6b7280;">${__("الإجمالي")}</div>
								<div style="font-size: 28px; font-weight: 700; color: #059669;">
									${POSUtils.formatCurrency(this.grandTotal, currency)}
								</div>
								${change > 0 ? `
								<div style="font-size: 13px; color: #6b7280; margin-top: 8px;">${__("الباقي")}</div>
								<div style="font-size: 20px; font-weight: 700; color: #2563eb;">
									${POSUtils.formatCurrency(change, currency)}
								</div>` : ""}
							</div>
						</div>
					`,
				},
			],
			primary_action_label: `🖨 ${__("طباعة الإيصال")}`,
			primary_action: () => {
				this._printReceipt(invoiceDoc);
				successDialog.hide();
			},
			secondary_action_label: __("إغلاق"),
			secondary_action: () => successDialog.hide(),
		});

		successDialog.show();

		// Clear cart & reset
		this.app.cart.clearCart();

		// Auto-close after 6 seconds
		setTimeout(() => {
			if (successDialog.$wrapper && successDialog.$wrapper.is(":visible")) {
				successDialog.hide();
			}
		}, 6000);
	}

	// ── Receipt Printing ───────────────────────────────────────

	_printReceipt(invoiceDoc) {
		// Build a simple text receipt and trigger browser print
		const currency = this.app.posProfile.currency;
		const now = new Date();

		let receiptHTML = `
			<div style="text-align:center; margin-bottom:16px;">
				<div style="font-size:18px; font-weight:700;">${this.app.posProfile.company}</div>
				<div style="font-size:12px; color:#6b7280;">${now.toLocaleString("ar")}</div>
				<div style="font-size:12px;">${__("رقم الفاتورة")}: ${invoiceDoc.name}</div>
			</div>
			<hr style="border-top: 1px dashed #ccc; margin: 10px 0;">
			<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:10px;">
				<tr style="border-bottom:1px solid #eee;">
					<th style="text-align:right; padding:4px 2px;">${__("الصنف")}</th>
					<th style="text-align:center; padding:4px 2px;">${__("الكمية")}</th>
					<th style="text-align:left; padding:4px 2px;">${__("الإجمالي")}</th>
				</tr>
		`;

		(invoiceDoc.items || []).forEach((item) => {
			receiptHTML += `
				<tr>
					<td style="padding:4px 2px;">${item.item_name}</td>
					<td style="text-align:center; padding:4px 2px;">${item.qty} × ${POSUtils.formatCurrency(item.rate, currency)}</td>
					<td style="text-align:left; padding:4px 2px;">${POSUtils.formatCurrency(item.amount, currency)}</td>
				</tr>
			`;
		});

		receiptHTML += `
			</table>
			<hr style="border-top: 1px dashed #ccc; margin: 10px 0;">
			<div style="display:flex; justify-content:space-between; font-size:13px;">
				<span>${__("المجموع")}</span>
				<span>${POSUtils.formatCurrency(invoiceDoc.grand_total, currency)}</span>
			</div>
			${invoiceDoc.discount_amount ? `
			<div style="display:flex; justify-content:space-between; font-size:13px;">
				<span>${__("الخصم")}</span>
				<span>- ${POSUtils.formatCurrency(invoiceDoc.discount_amount, currency)}</span>
			</div>` : ""}
			<div style="display:flex; justify-content:space-between; font-size:16px; font-weight:700; margin-top:6px;">
				<span>${__("الإجمالي الكلي")}</span>
				<span>${POSUtils.formatCurrency(invoiceDoc.grand_total, currency)}</span>
			</div>
			<hr style="border-top: 1px dashed #ccc; margin: 10px 0;">
			<div style="text-align:center; font-size:12px; color:#6b7280; margin-top:10px;">
				${__("شكراً لتسوقكم معنا")}
			</div>
		`;

		// Inject and print
		let $receipt = $("#pos-receipt");
		if (!$receipt.length) {
			$receipt = $('<div id="pos-receipt"></div>').appendTo("body");
		}
		$receipt.html(receiptHTML);

		$("body").addClass("pos-printing");
		setTimeout(() => {
			window.print();
			$("body").removeClass("pos-printing");
		}, 100);
	}
}

window.POSPayment = POSPayment;
