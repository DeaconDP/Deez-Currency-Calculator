export interface TipDestination {
  asset: string;
  label: string;
  network: string;
  address: string;
  qrAssetPath: string;
}
export const tipDestinations: TipDestination[] = [
  {
    asset: "Bitcoin",
    label: "btc",
    network: "Bitcoin network",
    address: "REPLACE_WITH_BITCOIN_ADDRESS",
    qrAssetPath: "/qr/btc.png",
  },
  {
    asset: "USD Coin",
    label: "usdc",
    network: "Solana network",
    address: "REPLACE_WITH_SOLANA_USDC_ADDRESS",
    qrAssetPath: "/qr/usdc.png",
  },
];
