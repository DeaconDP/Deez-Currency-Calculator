export interface TipDestination {
  asset: string;
  network: string;
  address: string;
  qrAssetPath: string;
}
export const tipDestinations: TipDestination[] = [
  {
    asset: "Bitcoin",
    network: "Bitcoin network",
    address: "REPLACE_WITH_BITCOIN_ADDRESS",
    qrAssetPath: "/qr/bitcoin-placeholder.svg",
  },
  {
    asset: "USD Coin",
    network: "Solana network",
    address: "REPLACE_WITH_SOLANA_USDC_ADDRESS",
    qrAssetPath: "/qr/usdc-placeholder.svg",
  },
];
