// ============================================================
//  Custom POS — Product Grid Component
//  pos_item_grid.js
// ============================================================

class POSItemGrid {
	constructor(app) {
		this.app = app;
		this.$wrapper = null;
		this.currentCategory = null; // null = All
		this.currentSearch = "";
		this.items = [];
		this.start = 0;
		this.pageLength = 40;
		this.hasMore = false;
		this.loading = false;
	}

	// ── DOM Rendering ─────────────────────────────────────────

	render() {
		const html = `
			<div class="pos-products-panel">
				<div class="pos-top-toolbar">
					<input type="text" class="pos-customer-input" id="pos-customer-input"
						placeholder="${__("تحديد العميل (رقم الجوال أو الاسم)...")}"
						autocomplete="off">
					<button class="pos-btn-suspend" id="pos-btn-suspend">
						${__("فواتير معلقة")}
						<span class="pos-suspend-badge" id="pos-suspend-count">0</span>
					</button>
					<button class="pos-btn-new" id="pos-btn-new">+ ${__("فاتورة جديدة")}</button>
				</div>
				<div class="pos-categories" id="pos-categories"></div>
				<input type="text" class="pos-search-box" id="pos-search-box"
					placeholder="${__("بحث بالباركود أو اسم المنتج...")}">
				<div class="pos-product-grid" id="pos-product-grid">
					<div class="pos-loading">
						<div class="pos-spinner"></div>
					</div>
				</div>
			</div>
		`;
		this.$wrapper = $(html);
		this.app.$container.append(this.$wrapper);
		this._bindEvents();
	}

	// ── Events ────────────────────────────────────────────────

	_bindEvents() {
		// Customer input autocomplete
		const $custInput = this.$wrapper.find("#pos-customer-input");
		$custInput.on("input", POSUtils.debounce((e) => {
			const val = e.target.value.trim();
			if (!val) {
				const defaultCust = this.app.posProfile?.customer || null;
				this.app.cart.setCustomer(defaultCust, defaultCust);
				this._clearCustomerDropdown();
				return;
			}
			this._searchCustomers(val);
		}, 350));

		// Barcode / search
		const $search = this.$wrapper.find("#pos-search-box");
		const debouncedSearch = POSUtils.debounce((term) => {
			this._doSearch(term, false);
		}, 350);

		$search.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this._doSearch($search.val().trim(), true);
			}
		});

		$search.on("input", (e) => {
			debouncedSearch(e.target.value.trim());
		});

		// Category
		this.$wrapper.on("click", ".pos-category-btn", (e) => {
			const cat = $(e.currentTarget).data("group");
			this._setCategory(cat);
		});

		// Load more
		this.$wrapper.on("click", "#pos-load-more", () => {
			this._loadItems(true, false);
		});

		// New invoice
		this.$wrapper.find("#pos-btn-new").on("click", () => {
			this.app.cart.newInvoice();
		});

		// Suspended invoices
		this.$wrapper.find("#pos-btn-suspend").on("click", () => {
			this.app.cart.showSuspendedDialog();
		});
	}

	// ── Categories ────────────────────────────────────────────

	async loadCategories() {
		// 1. Check if POS Profile specifies allowed item groups
		const profileGroups = (this.app.posProfile?.item_groups || [])
			.map((row) => row.item_group)
			.filter(Boolean);

		if (profileGroups.length) {
			this.rootGroup = profileGroups[0];
			this._renderCategories(profileGroups);
			return;
		}

		// 2. Otherwise load parent item group hierarchy
		try {
			const r = await frappe.call({
				method: "erpnext.selling.page.point_of_sale.point_of_sale.get_parent_item_group",
				args: { pos_profile: this.app.posProfile.name },
			});
			this.rootGroup = r.message || "All Item Groups";
			this._renderCategories([]);

			const children = await frappe.db.get_list("Item Group", {
				filters: { parent_item_group: this.rootGroup },
				fields: ["name"],
				limit: 25,
			});
			const groups = (children || []).map((c) => c.name);
			this._renderCategories(groups);
		} catch (err) {
			console.error("Custom POS: Error loading categories", err);
			this._renderCategories([]);
		}
	}

	_renderCategories(groups) {
		const $container = this.$wrapper.find("#pos-categories");
		const all = [null, ...groups]; // null = "الكل"
		$container.html(
			all
				.map((g) => {
					const label = g || __("الكل");
					const active = this.currentCategory === g ? "active" : "";
					return `<button class="pos-category-btn ${active}" data-group="${g || ""}">${label}</button>`;
				})
				.join("")
		);
	}

	_setCategory(group) {
		this.currentCategory = group || null;
		this.start = 0;
		// Refresh active state
		this.$wrapper.find(".pos-category-btn").each(function () {
			const g = $(this).data("group") || null;
			$(this).toggleClass("active", g === group || (g === "" && group === ""));
		});
		this._loadItems(false, false);
	}

	// ── Items Fetching ─────────────────────────────────────────

	async loadItems() {
		await this.loadCategories();
		await this._loadItems(false, false);
	}

	async _loadItems(append = false, autoAddIfSingle = false) {
		if (this.loading) return;
		this.loading = true;

		if (!append) {
			this.start = 0;
			this.$wrapper.find("#pos-product-grid").html(
				`<div class="pos-loading"><div class="pos-spinner"></div></div>`
			);
		}

		const args = {
			start: this.start,
			page_length: this.pageLength,
			price_list: this.app.posProfile.selling_price_list,
			item_group: this.currentCategory || this.rootGroup || "All Item Groups",
			pos_profile: this.app.posProfile.name,
			search_term: this.currentSearch,
		};

		try {
			const r = await frappe.call({
				method: "erpnext.selling.page.point_of_sale.point_of_sale.get_items",
				args,
			});

			let incoming = [];
			if (r.message) {
				if (Array.isArray(r.message)) {
					incoming = r.message;
				} else if (Array.isArray(r.message.items)) {
					incoming = r.message.items;
				}
			}

			// If barcode / enter search returned exactly 1 item, auto-add to cart
			if (autoAddIfSingle && incoming.length === 1) {
				const singleItem = incoming[0];
				this._addItemDirectly(singleItem);
				this.$wrapper.find("#pos-search-box").val("");
				this.currentSearch = "";
				this.loading = false;
				await this._loadItems(false, false);
				return;
			}

			this.hasMore = incoming.length >= this.pageLength;
			this.start += incoming.length;

			if (append) {
				this.items = [...this.items, ...incoming];
			} else {
				this.items = incoming;
			}

			this._renderGrid();
		} catch (err) {
			this.$wrapper.find("#pos-product-grid").html(
				`<div class="pos-empty-state">${__("تعذّر تحميل المنتجات. تحقق من الاتصال.")}</div>`
			);
			console.error("Custom POS: get_items error", err);
		} finally {
			this.loading = false;
		}
	}

	_doSearch(term, isBarcodeScan = false) {
		this.currentSearch = term;
		this.start = 0;
		this._loadItems(false, isBarcodeScan);
	}

	// ── Grid Rendering ─────────────────────────────────────────

	_renderGrid() {
		const $grid = this.$wrapper.find("#pos-product-grid");

		if (!this.items.length) {
			$grid.html(
				`<div class="pos-empty-state">📭 ${__("لا توجد منتجات مطابقة")}</div>`
			);
			return;
		}

		const cards = this.items.map((item) => this._cardHTML(item)).join("");
		const loadMore = this.hasMore
			? `<button id="pos-load-more" class="pos-load-more">${__("تحميل المزيد...")}</button>`
			: "";

		$grid.html(cards + loadMore);

		// Bind card clicks
		$grid.find(".pos-product-card").on("click", (e) => {
			const code = $(e.currentTarget).data("code");
			this._onCardClick(code);
		});
	}

	_cardHTML(item) {
		const price = POSUtils.flt(item.price_list_rate);
		const currency = item.currency || this.app.posProfile.currency;
		const imgOrIcon = item.item_image
			? `<img class="pos-product-img" src="${item.item_image}" alt="${item.item_name}" loading="lazy">`
			: `<div class="pos-product-icon">📦</div>`;

		const stock = item.is_stock_item
			? `<div class="pos-product-stock">${__("المخزون")}: ${POSUtils.flt(item.actual_qty)}</div>`
			: "";

		return `
			<div class="pos-product-card" data-code="${item.item_code}">
				${imgOrIcon}
				<div class="pos-product-name">${item.item_name}</div>
				<div class="pos-product-price">${POSUtils.formatCurrency(price, currency)}</div>
				${stock}
			</div>
		`;
	}

	// ── Card Click → Add to Cart ───────────────────────────────

	_addItemDirectly(item) {
		if (!item) return;

		const defaultUom = item.uom || item.stock_uom || item.sales_uom || "Unit";
		const uoms = [
			{
				uom: defaultUom,
				conversion_factor: 1,
				rate: POSUtils.flt(item.price_list_rate),
			},
		];

		if (item.stock_uom && item.stock_uom !== defaultUom) {
			uoms.push({
				uom: item.stock_uom,
				conversion_factor: 1,
				rate: POSUtils.flt(item.price_list_rate),
			});
		}

		if (item.sales_uom && item.sales_uom !== defaultUom && item.sales_uom !== item.stock_uom) {
			uoms.push({
				uom: item.sales_uom,
				conversion_factor: 1,
				rate: POSUtils.flt(item.price_list_rate),
			});
		}

		const selectedUOM = { ...uoms[0], _all: uoms };
		this.app.cart.addItem(item, selectedUOM);
	}

	_onCardClick(itemCode) {
		const item = this.items.find((i) => i.item_code === itemCode);
		if (!item) return;
		this._addItemDirectly(item);
	}

	// ── Customer Search ────────────────────────────────────────

	_searchCustomers(term) {
		if (!term || term.length < 2) {
			this._clearCustomerDropdown();
			return;
		}
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Customer",
				or_filters: [
					["customer_name", "like", `%${term}%`],
					["name", "like", `%${term}%`],
					["mobile_no", "like", `%${term}%`],
				],
				fields: ["name", "customer_name", "mobile_no"],
				page_length: 8,
			},
			callback: (r) => {
				this._renderCustomerDropdown(r.message || []);
			},
		});
	}

	_renderCustomerDropdown(customers) {
		// Remove any existing dropdown
		this._clearCustomerDropdown();
		if (!customers.length) return;

		const $input = this.$wrapper.find("#pos-customer-input");
		const $drop = $(`
			<ul class="pos-customer-dropdown" style="
				position:absolute; z-index:7000;
				background:#fff; border:1px solid var(--pos-border);
				border-radius:var(--pos-radius); list-style:none;
				padding:4px 0; margin:0; min-width:240px;
				box-shadow:0 4px 20px rgba(0,0,0,0.12);
			"></ul>
		`);

		customers.forEach((c) => {
			const $li = $(`<li style="padding:8px 14px; cursor:pointer; font-size:14px; direction:rtl;">
				<strong>${c.customer_name}</strong>
				${c.mobile_no ? `<br><small style="color:#9ca3af">${c.mobile_no}</small>` : ""}
			</li>`);
			$li.on("click", () => {
				$input.val(c.customer_name);
				this.app.cart.setCustomer(c.name, c.customer_name);
				this._clearCustomerDropdown();
			});
			$drop.append($li);
		});

		// Position under input
		const offset = $input.offset();
		$drop.css({ top: offset.top + $input.outerHeight(), left: offset.left });
		$("body").append($drop);

		// Close on outside click
		$(document).one("click.pos-customer-drop", () => this._clearCustomerDropdown());
	}

	_clearCustomerDropdown() {
		$(".pos-customer-dropdown").remove();
		$(document).off("click.pos-customer-drop");
	}

	// ── Suspend badge update ───────────────────────────────────

	updateSuspendBadge(count) {
		this.$wrapper.find("#pos-suspend-count").text(count);
	}
}

window.POSItemGrid = POSItemGrid;
