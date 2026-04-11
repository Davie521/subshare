/** Format cents to display currency string */
export function formatMoney(cents: number, currency = "CNY"): string {
  const amount = cents / 100;
  const symbols: Record<string, string> = {
    CNY: "¥",
    USD: "$",
    HKD: "HK$",
    CAD: "CA$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
  };
  const symbol = symbols[currency] || currency + " ";
  return `${symbol}${amount.toFixed(2)}`;
}
