// Previous BNB Chain Mainnet deployment for historical claims. Never put signing credentials here.
window.__SINGULAR_ENV__ = {
  VITE_DATA_MODE: 'onchain',
  VITE_CHAIN_ID: '56',
  VITE_RPC_URL: 'https://bsc-dataseed-public.bnbchain.org',
  VITE_LOG_RPC_URL: 'https://bsc-rpc.publicnode.com',
  VITE_EXPLORER_URL: 'https://bscscan.com',
  VITE_POOL_MANAGER_ADDRESS: '0x6912609208be953fd6b9d0176841f3a64746ce82',
  VITE_FEE_VAULT_ADDRESS: '0xdbfbf21d83415c3907104130adec8cc39092fd3a',
  VITE_RANDOMNESS_PROVIDER_ADDRESS: '0x2bd71367b1f516373ae9931327d5c04b4dcf8804',
  // A conservative start before this deployment; pool state is read directly.
  VITE_DEPLOYMENT_BLOCK: '125760000'
};
