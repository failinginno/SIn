// Public runtime configuration. Generated deployments may replace __SINGULAR_ENV__.
// Keep secrets and signing credentials out of this browser file.
window.SINGULAR_TESTNET_CONFIG = Object.freeze((function (env) {
  return {
    dataMode: env.VITE_DATA_MODE || 'demo',
    chainId: Number(env.VITE_CHAIN_ID || 97),
    rpcUrl: env.VITE_RPC_URL || 'https://bsc-testnet-dataseed.bnbchain.org',
    logRpcUrl: env.VITE_LOG_RPC_URL || env.VITE_RPC_URL || 'https://bsc-testnet-dataseed.bnbchain.org',
    explorerUrl: env.VITE_EXPLORER_URL || 'https://testnet.bscscan.com',
    poolManagerAddress: env.VITE_POOL_MANAGER_ADDRESS || '',
    feeVaultAddress: env.VITE_FEE_VAULT_ADDRESS || '',
    randomnessProviderAddress: env.VITE_RANDOMNESS_PROVIDER_ADDRESS || '',
    deploymentBlock: Number(env.VITE_DEPLOYMENT_BLOCK || 0)
  };
})(window.__SINGULAR_ENV__ || {}));
