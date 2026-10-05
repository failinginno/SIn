// Public BNB Chain Testnet deployment only. No private keys or signing credentials.
window.__SINGULAR_ENV__ = {
  VITE_DATA_MODE: 'onchain',
  VITE_CHAIN_ID: '97',
  VITE_RPC_URL: 'https://bsc-testnet-dataseed.bnbchain.org',
  VITE_EXPLORER_URL: 'https://testnet.bscscan.com',
  VITE_POOL_MANAGER_ADDRESS: '0x0128bf9d65bc88ae0cb1849e4cde85e4b2161bf6',
  VITE_FEE_VAULT_ADDRESS: '0x865c1647ba90f2affc875a9d7ed50093c8f4994b',
  VITE_RANDOMNESS_PROVIDER_ADDRESS: '0x6a649c1c35422aaaeecdeb1a63ee12c32cab9b11',
  // Manager deployment block. Event history starts here; pool state is read directly.
  VITE_DEPLOYMENT_BLOCK: '134902966'
};
