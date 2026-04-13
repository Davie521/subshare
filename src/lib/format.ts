/** Currencies quoted without decimal subdivisions (ISO 4217 exponent 0) */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "IDR", "VND", "HUF", "CLP", "TWD"]);

const SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  HKD: "HK$",
  CAD: "CA$",
  AUD: "A$",
  SGD: "S$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  KRW: "₩",
  INR: "₹",
  BRL: "R$",
  RUB: "₽",
  ZAR: "R",
  AED: "AED ",
  IDR: "Rp ",
  SEK: "kr ",
};

/** Format stored price (minor units for most currencies, whole units for zero-decimal) to display string. */
export function formatMoney(amount: number, currency = "CNY"): string {
  const symbol = SYMBOLS[currency] || `${currency} `;
  if (ZERO_DECIMAL.has(currency)) {
    return `${symbol}${amount.toLocaleString("en-US")}`;
  }
  return `${symbol}${(amount / 100).toFixed(2)}`;
}
