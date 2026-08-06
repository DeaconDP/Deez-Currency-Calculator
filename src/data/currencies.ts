import type { CurrencyDefinition } from "../types";

export const currencies: CurrencyDefinition[] = [
  ["ZAR", "South African Rand", "fiat", 2],
  ["USD", "US Dollar", "fiat", 2],
  ["EUR", "Euro", "fiat", 2],
  ["GBP", "British Pound", "fiat", 2],
  ["AUD", "Australian Dollar", "fiat", 2],
  ["CAD", "Canadian Dollar", "fiat", 2],
  ["CHF", "Swiss Franc", "fiat", 2],
  ["CNY", "Chinese Yuan", "fiat", 2],
  ["JPY", "Japanese Yen", "fiat", 0],
  ["INR", "Indian Rupee", "fiat", 2],
  ["NZD", "New Zealand Dollar", "fiat", 2],
  ["BRL", "Brazilian Real", "fiat", 2],
  ["BWP", "Botswana Pula", "fiat", 2],
  ["KES", "Kenyan Shilling", "fiat", 2],
  ["NGN", "Nigerian Naira", "fiat", 2],
  ["AED", "UAE Dirham", "fiat", 2],
  ["BTC", "Bitcoin", "crypto", 8],
  ["ETH", "Ethereum", "crypto", 8],
  ["USDC", "USD Coin", "crypto", 6],
  ["USDT", "Tether", "crypto", 6],
].map(([code, name, type, decimals]) => ({
  code: String(code),
  name: String(name),
  type: type as "fiat" | "crypto",
  decimals: Number(decimals),
}));

export const getCurrency = (code: string) =>
  currencies.find((currency) => currency.code === code);
