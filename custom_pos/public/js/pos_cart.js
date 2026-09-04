// ============================================================
//  Custom POS — Cart Component
//  pos_cart.js
// ============================================================

class POSCart {
	constructor(app) {
		this.app = app;
		this.$wrapper = null;
		this.items = [];           // cart item array
		this.customer = null;      // { name, display_name }
		this.discount = 0;         // fixed discount amount
		this.selectedPayment = null; // mode_of_payment string
	}

	// ── DOM Rendering ─────────────────────────────────────────

	render() {
		const html = `
			<div class="pos-cart-panel">
				<div class="pos-cart-items" id="pos-cart-items">
					<div class="pos-cart-empty">${__("السلة فارغة")}</div>
				</div>

				<div class="pos-cart-summary">
					<div class="pos-summary-row">
						<span>${__("المجموع الجزئي")}</span>
						<span id="pos-subtotal">0.00</span>
					</div>
					<div class="pos-summary-row">
						<span>${__("الخصم (قيمة)")}</span>
						<input type="number" id="pos-discount" class="pos-discount-input"
							value="0" min="0" placeholder="0">
					</div>
					<div class="pos-summary-row">
						<span>${__("وسيلة الدفع")}</span>
						<select id="pos-payment-method" class="pos-payment-select">
							<option value="">${__("اختر...")}</option>
						</select>
					</div>
					<div class="pos-summary-row pos-summary-total">
						<span>${__("المجموع الكلي")}</span>
						<span class="pos-grand-total-val" id="pos-grand-total">0.00</span>
					</div>
				</div>

				<div class="pos-checkout-actions">
					<button class="pos-btn-clear" id="pos-btn-clear">${__("تفريغ السلة")}</button>
					<button class="pos-btn-drawer" id="pos-btn-drawer">${__("فتح الدرج")}</button>
					<button class="pos-btn-pay" id="pos-btn-pay">${__("إتمام الدفع و الترحيل")}</button>
				</div>
			</div>
		`;
		this.$wrapper = $(html);
		this.app.$container.append(this.$wrapper);
		this._bindEvents();
		this._populatePaymentMethods();
	}

	// ── Events ────────────────────────────────────────────────

	_bindEvents() {
		// Discount change
		this.$wrapper.find("#pos-discount").on("input", () => {
			this.discount = POSUtils.flt(this.$wrapper.find("#pos-discount").val());
			this._updateTotals();
		});

		// Clear
		this.$wrapper.find("#pos-btn-clear").on("click", async () => {
			if (!this.items.length) return;
			const ok = await POSUtils.confirm(
				__("تفريغ السلة"),
				__("هل تريد تفريغ السلة الحالية؟")
			);
			if (ok) this.clearCart();
		});

		// Open drawer
		this.$wrapper.find("#pos-btn-drawer").on("click", () => {
			POSUtils.alert(__("تم إرسال أمر فتح الدرج"), "blue");
			// Future: send ESC/POS command to printer
		});

		// Pay button
		this.$wrapper.find("#pos-btn-pay").on("click", () => {
			this._onPayClick();
		});

		// Payment method change
		this.$wrapper.find("#pos-payment-method").on("change", (e) => {
			this.selectedPayment = e.target.value;
		});

		// Delegate events on cart items (qty, uom, price, remove)
		this.$wrapper.on("click", ".pos-qty-btn[data-action='inc']", (e) => {
			const idx = POSUtils.cint($(e.currentTarget).data("idx"));
			this._changeQty(idx, 1);
		});
		this.$wrapper.on("click", ".pos-qty-btn[data-action='dec']", (e) => {
			const idx = POSUtils.cint($(e.currentTarget).data("idx"));
			this._changeQty(idx, -1);
		});
		this.$wrapper.on("change", ".pos-qty-input", (e) => {
			const idx = POSUtils.cint($(e.currentTarget).data("idx"));
			const newQty = POSUtils.flt(e.target.value);
			if (newQty <= 0) {
				this.removeItem(idx);
			} else {
				this.items[idx].qty = newQty;
				this.items[idx].amount = newQty * this.items[idx].rate;
				this._renderItems();
			}
		});
		this.$wrapper.on("click", ".pos-btn-remove", (e) => {
			const idx = POSUtils.cint($(e.currentTarget).data("idx"));
			this.removeItem(idx);
		});
		this.$wrapper.on("change", ".pos-uom-select", (e) => {
			const idx = POSUtils.cint($(e.currentTarget).data("idx"));
			this._changeUOM(idx, e.target.value);
		});
		this.$wrapper.on("change", ".pos-price-input", (e) => {
			const idx = POSUtils.cint($(e.currentTarget).data("idx"));
			const newRate = POSUtils.flt(e.target.value);
			this.items[idx].rate = newRate;
			this.items[idx].amount = this.items[idx].qty * newRate;
			this.items[idx].custom_rate = true;
			this._renderItems();
		});
	}

	// ── Payment Methods ────────────────────────────────────────

	_populatePaymentMethods() {
		const payments = this.app.posProfile.payments || [];
		const $sel = this.$wrapper.find("#pos-payment-method");
		$sel.html(`<option value="">${__("اختر...")}</option>`);
		payments.forEach((p) => {
			const opt = new Option(p.mode_of_payment, p.mode_of_payment);
			$sel.append(opt);
		});
		if (payments.length) {
			$sel.val(payments[0].mode_of_payment);
			this.selectedPayment = payments[0].mode_of_payment;
		}
	}

	// ── Cart State Management ──────────────────────────────────

	addItem(erpItem, uomObj) {
		// Check if same item + uom already in cart
		const existing = this.items.findIndex(
			(i) => i.item_code === erpItem.item_code && i.uom === uomObj.uom
		);

		if (existing > -1) {
			this.items[existing].qty += 1;
			this.items[existing].amount =
				this.items[existing].qty * this.items[existing].rate;
		} else {
			const rate = POSUtils.flt(uomObj.rate || erpItem.price_list_rate);
			this.items.unshift({
				item_code: erpItem.item_code,
				item_name: erpItem.item_name,
				qty: 1,
				uom: uomObj.uom,
				stock_uom: erpItem.stock_uom,
				conversion_factor: uomObj.conversion_factor || 1,
				rate,
				amount: rate,
				custom_rate: false,
				serial_no: "",
				batch_no: erpItem.batch_no || "",
				item_group: erpItem.item_group || "",
				_uom_list: uomObj._all || [uomObj],
				_erpItem: erpItem,
			});
		}

		this._renderItems();
		POSUtils.alert(`${erpItem.item_name} ${__("أُضيف للسلة")}`, "green");
	}

	removeItem(idx) {
		this.items.splice(idx, 1);
		this._renderItems();
	}

	_changeQty(idx, delta) {
		this.items[idx].qty = Math.max(0, this.items[idx].qty + delta);
		if (this.items[idx].qty === 0) {
			this.items.splice(idx, 1);
		} else {
			this.items[idx].amount = this.items[idx].qty * this.items[idx].rate;
		}
		this._renderItems();
	}

	_changeUOM(idx, newUOM) {
		const item = this.items[idx];
		item.uom = newUOM;
		// If the item has a known conversion factor, adjust conversion_factor and rate
		const uomRow = (item._uom_list || []).find((u) => u.uom === newUOM);
		if (uomRow) {
			item.conversion_factor = uomRow.conversion_factor || 1;
			if (!item.custom_rate) {
				item.rate = POSUtils.flt(uomRow.rate);
			}
		}
		item.amount = item.qty * item.rate;
		this._renderItems();
	}

	clearCart() {
		this.items = [];
		this.discount = 0;
		const defaultCustomer = this.app.posProfile?.customer || null;
		this.customer = defaultCustomer ? { name: defaultCustomer, display_name: defaultCustomer } : null;
		this.$wrapper.find("#pos-discount").val("0");
		if (this.app.grid?.$wrapper) {
			this.app.grid.$wrapper.find("#pos-customer-input").val(defaultCustomer || "");
		}
		this._renderItems();
	}

	setCustomer(name, displayName) {
		this.customer = name ? { name, display_name: displayName || name } : null;
	}

	// ── UI Rendering ───────────────────────────────────────────

	_renderItems() {
		const $container = this.$wrapper.find("#pos-cart-items");

		if (!this.items.length) {
			$container.html(
				`<div class="pos-cart-empty">${__("السلة فارغة")}</div>`
			);
			this._updateTotals();
			return;
		}

		const rows = this.items.map((item, idx) => this._itemRowHTML(item, idx)).join("");
		$container.html(rows);
		this._updateTotals();
	}

	_itemRowHTML(item, idx) {
		const currency = this.app.posProfile.currency;
		const uomOptions = (item._uom_list || [{ uom: item.uom }])
			.map(
				(u) =>
					`<option value="${u.uom}" ${u.uom === item.uom ? "selected" : ""}>${u.uom}</option>`
			)
			.join("");

		return `
			<div class="pos-cart-item" data-idx="${idx}">
				<div class="pos-cart-item-header">
					<span class="pos-cart-item-name">${item.item_name}</span>
					<span class="pos-cart-item-total">
						${POSUtils.formatCurrency(item.qty * item.rate, currency)}
					</span>
					<button class="pos-btn-remove" data-idx="${idx}" title="${__("حذف")}">🗑</button>
				</div>
				<div class="pos-cart-item-controls">
					<div class="pos-qty-controls">
						<button class="pos-qty-btn" data-action="dec" data-idx="${idx}">−</button>
						<input type="number" class="pos-qty-input" data-idx="${idx}"
							value="${item.qty}" min="0.001" step="any">
						<button class="pos-qty-btn" data-action="inc" data-idx="${idx}">+</button>
					</div>
					<select class="pos-uom-select" data-idx="${idx}">
						${uomOptions}
					</select>
					<input type="number" class="pos-price-input" data-idx="${idx}"
						value="${item.rate}" min="0" step="0.01"
						title="${__("السعر")}">
				</div>
			</div>
		`;
	}

	_updateTotals() {
		const subtotal = this.items.reduce(
			(s, i) => s + i.qty * i.rate,
			0
		);
		const discount = Math.min(POSUtils.flt(this.discount), subtotal);
		const grandTotal = Math.max(subtotal - discount, 0);
		const currency = this.app.posProfile.currency;

		this.$wrapper.find("#pos-subtotal").text(POSUtils.formatCurrency(subtotal, currency));
		this.$wrapper.find("#pos-grand-total").text(POSUtils.formatCurrency(grandTotal, currency));
	}

	get grandTotal() {
		const subtotal = this.items.reduce((s, i) => s + i.qty * i.rate, 0);
		return Math.max(subtotal - POSUtils.flt(this.discount), 0);
	}

	get subtotal() {
		return this.items.reduce((s, i) => s + i.qty * i.rate, 0);
	}

	// ── Suspend / Resume ───────────────────────────────────────

	suspendInvoice() {
		if (!this.items.length) {
			POSUtils.alert(__("السلة فارغة — لا يوجد شيء للتعليق"), "orange");
			return;
		}
		const invoice = {
			uid: POSUtils.uid(),
			customer: this.customer,
			items: JSON.parse(JSON.stringify(this.items)),
			discount: this.discount,
			payment: this.selectedPayment,
			time: new Date().toLocaleTimeString("ar"),
			date: new Date().toLocaleDateString("ar"),
		};
		const all = POSUtils.storage.push(invoice);
		this.app.grid.updateSuspendBadge(all.length);
		POSUtils.alert(__("تم تعليق الفاتورة بنجاح"), "orange");
		this.clearCart();
	}

	showSuspendedDialog() {
		const all = POSUtils.storage.getAll();
		const currency = this.app.posProfile.currency;

		if (!all.length) {
			POSUtils.alert(__("لا توجد فواتير معلقة"), "blue");
			return;
		}

		const overlay = $(`
			<div class="pos-payment-modal-overlay" id="pos-suspend-overlay">
				<div class="pos-suspend-dialog">
					<h3 style="margin-bottom:16px; font-size:18px; font-weight:700;">
						${__("الفواتير المعلقة")}
					</h3>
					<div id="pos-suspended-list"></div>
					<button id="pos-suspend-close" class="pos-btn-cancel" style="width:100%; margin-top:12px;">
						${__("إغلاق")}
					</button>
				</div>
			</div>
		`);

		const $list = overlay.find("#pos-suspended-list");
		all.forEach((inv) => {
			const total = inv.items.reduce((s, i) => s + i.qty * i.rate, 0);
			const customerName = inv.customer ? inv.customer.display_name : __("عميل نقدي");
			const $row = $(`
				<div class="pos-suspended-item">
					<div class="pos-suspended-info">
						<div class="pos-suspended-customer">${customerName}</div>
						<div class="pos-suspended-meta">
							${inv.items.length} ${__("صنف")} •
							${POSUtils.formatCurrency(total, currency)} •
							${inv.time}
						</div>
					</div>
					<button class="pos-btn-restore" data-uid="${inv.uid}">${__("استعادة")}</button>
				</div>
			`);
			$list.append($row);
		});

		$("body").append(overlay);

		overlay.on("click", ".pos-btn-restore", (e) => {
			const uid = $(e.currentTarget).data("uid");
			this._restoreInvoice(uid);
			overlay.remove();
		});

		overlay.find("#pos-suspend-close").on("click", () => overlay.remove());
		overlay.on("click", (e) => {
			if ($(e.target).is("#pos-suspend-overlay")) overlay.remove();
		});
	}

	_restoreInvoice(uid) {
		const inv = POSUtils.storage.getAll().find((i) => i.uid === uid);
		if (!inv) return;

		// If current cart has items — suspend first
		if (this.items.length) this.suspendInvoice();

		this.items = inv.items;
		this.customer = inv.customer;
		this.discount = inv.discount || 0;
		this.$wrapper.find("#pos-discount").val(this.discount);

		const custDisplayName = inv.customer
			? inv.customer.display_name
			: (this.app.posProfile?.customer || "");

		if (this.app.grid?.$wrapper) {
			this.app.grid.$wrapper
				.find("#pos-customer-input")
				.val(custDisplayName);
		}

		const remaining = POSUtils.storage.remove(uid);
		this.app.grid.updateSuspendBadge(remaining.length);
		this._renderItems();
		POSUtils.alert(__("تم استعادة الفاتورة"), "green");
	}

	// ── New Invoice ────────────────────────────────────────────

	async newInvoice() {
		if (this.items.length) {
			const ok = await POSUtils.confirm(
				__("فاتورة جديدة"),
				__("هل تريد تعليق الفاتورة الحالية قبل فتح فاتورة جديدة؟")
			);
			if (ok) {
				this.suspendInvoice();
				return;
			}
		}
		this.clearCart();
	}

	// ── Pay button ─────────────────────────────────────────────

	_onPayClick() {
		if (!this.items.length) {
			POSUtils.alert(__("السلة فارغة!"), "red");
			return;
		}
		if (!this.selectedPayment) {
			POSUtils.alert(__("يرجى اختيار وسيلة الدفع"), "red");
			return;
		}
		this.app.payment.show(this.grandTotal);
	}
}

window.POSCart = POSCart;
