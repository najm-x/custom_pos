// ============================================================
//  Custom POS — Shared Utilities
//  pos_utils.js
// ============================================================

const POSUtils = {

	/**
	 * Format a number as currency string.
	 * @param {number} amount
	 * @param {string} currency  e.g. "YER" or "SAR"
	 * @returns {string}  e.g. "1,500.00 ر.ي"
	 */
	formatCurrency(amount, currency) {
		const cur = currency || frappe.boot?.sysdefaults?.currency || "YER";
		const symbols = {
			YER: "ر.ي",
			SAR: "ر.س",
			USD: "$",
			EUR: "€",
		};
		const sym = symbols[cur] || cur;
		const formatted = parseFloat(amount || 0)
			.toFixed(2)
			.replace(/\d(?=(\d{3})+\.)/g, "$&,");
		return `${formatted} ${sym}`;
	},

	/**
	 * Debounce wrapper — delays fn execution until delay ms after last call.
	 */
	debounce(fn, delay = 300) {
		let timer;
		return function (...args) {
			clearTimeout(timer);
			timer = setTimeout(() => fn.apply(this, args), delay);
		};
	},

	/**
	 * Show a Frappe-style toast notification.
	 * @param {string} message
	 * @param {"green"|"red"|"orange"|"blue"} type
	 */
	alert(message, type = "green") {
		frappe.show_alert({ message, indicator: type }, 4);
	},

	/**
	 * Show a simple confirmation dialog, returns Promise<boolean>.
	 */
	confirm(title, message) {
		return new Promise((resolve) => {
			frappe.confirm(message, () => resolve(true), () => resolve(false));
		});
	},

	/**
	 * Generate a unique local ID (for suspended invoice keys etc.)
	 */
	uid() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	},

	/**
	 * Safe parseFloat — returns 0 for NaN/null/undefined.
	 */
	flt(val) {
		const n = parseFloat(val);
		return isNaN(n) ? 0 : n;
	},

	/**
	 * Safe parseInt.
	 */
	cint(val) {
		const n = parseInt(val, 10);
		return isNaN(n) ? 0 : n;
	},

	/**
	 * Get a nested value safely from an object.
	 * @param {object} obj
	 * @param {string} path  dot-separated e.g. "pos_profile.name"
	 */
	get(obj, path, fallback = null) {
		return path.split(".").reduce(
			(o, k) => (o && o[k] !== undefined ? o[k] : fallback),
			obj
		);
	},

	/**
	 * LocalStorage helpers for suspended invoices.
	 */
	storage: {
		getKey() {
			const user = (typeof frappe !== "undefined" && frappe.session?.user) ? frappe.session.user : "default";
			return `custom_pos_suspended_${user}`;
		},

		getAll() {
			try {
				return JSON.parse(localStorage.getItem(POSUtils.storage.getKey()) || "[]");
			} catch {
				return [];
			}
		},

		save(invoices) {
			localStorage.setItem(POSUtils.storage.getKey(), JSON.stringify(invoices));
		},

		push(invoice) {
			const list = POSUtils.storage.getAll();
			list.push(invoice);
			POSUtils.storage.save(list);
			return list;
		},

		remove(uid) {
			const list = POSUtils.storage.getAll().filter((i) => i.uid !== uid);
			POSUtils.storage.save(list);
			return list;
		},

		clear() {
			localStorage.removeItem(POSUtils.storage.getKey());
		},
	},
};

// Expose globally
window.POSUtils = POSUtils;
