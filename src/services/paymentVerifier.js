/**
 * Payment verification service - verifies FLOWER transactions on-chain via Alchemy
 */
const { PAYMENT_ADDRESS, FLOWER_CONTRACT_BASE, FLOWER_CONTRACT_RONIN } = require('./subscriptionService');

// Alchemy RPCs
const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/O07GS-UUppyzAt3Dngczk';
const ALCHEMY_RONIN = 'https://ronin-mainnet.g.alchemy.com/v2/O07GS-UUppyzAt3Dngczk';

// ERC-20 Transfer event signature
const TRANSFER_EVENT = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35bdc8';

/**
 * Determine network from tx hash
 * - Base txs start with 0x01 (or sometimes 0x02 for EIP-155)
 * - Ronin txs are different format (32 bytes with different prefix)
 * 
 * Actually, we need to use the tx hash format:
 * - Base: same as Ethereum, 66 chars, starts with 0x
 * - Ronin: also 66 chars but chain-specific
 * 
 * We can detect by trying RPCs - if Base returns a valid tx and Ronin doesn't, it's Base.
 */
function detectNetwork(txHash) {
  // Ronin tx hashes typically start with 0x, but are from a different chain
  // We can use the length and format to make an educated guess
  // Base uses Ethereum-format txs (same as mainnet)
  // Ronin uses a custom format but also 66 chars
  
  // For now, we'll try both RPCs to determine
  if (txHash.startsWith('0x') && txHash.length === 66) {
    // Could be either chain, need to check both
    return null; // Unknown, need to check
  }
  return 'base'; // Default to Base
}

/**
 * Verify a FLOWER payment transaction on Base or Ronin
 * Returns: { success: true, amount: n, from: address, network: 'base'/'ronin' }
 * or: { success: false, error: string }
 */
async function verifyFlowerPayment(txHash) {
  if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
    return { success: false, error: 'Invalid transaction hash format' };
  }

  // Try Base first
  let result = await verifyOnNetwork(txHash, 'base', ALCHEMY_BASE);
  if (result.success) return result;

  // Try Ronin
  result = await verifyOnNetwork(txHash, 'ronin', ALCHEMY_RONIN);
  if (result.success) return result;

  return { success: false, error: 'Transaction not found or not a valid FLOWER transfer' };
}

/**
 * Verify transaction on specific network
 */
async function verifyOnNetwork(txHash, network, rpcUrl) {
  try {
    // Get transaction receipt
    const receiptResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      })
    });

    if (!receiptResp.ok) {
      return { success: false, error: `RPC error: ${receiptResp.status}` };
    }

    const receiptData = await receiptResp.json();
    
    if (receiptData.error) {
      return { success: false, error: receiptData.error.message || 'RPC error' };
    }

    const receipt = receiptData.result;
    
    if (!receipt) {
      return { success: false, error: 'Transaction not found or still pending' };
    }

    // Check if transaction was successful (status: 0x1 = success)
    if (receipt.status !== '0x1') {
      return { success: false, error: 'Transaction failed on-chain' };
    }

    // Check if transaction is to the payment address
    const toAddress = receipt.to?.toLowerCase();
    if (toAddress !== PAYMENT_ADDRESS.toLowerCase()) {
      return { success: false, error: `Payment sent to wrong address. Expected ${PAYMENT_ADDRESS.substring(0, 10)}...` };
    }

    // Check logs for FLOWER Transfer event
    // Transfer(address from, address to, uint256 amount)
    // The event signature is: Transfer(address,address,uint256)
    // Topic 0 = keccak256("Transfer(address,address,uint256)")
    
    let tokenAmount = null;
    let fromAddress = null;

    for (const log of receipt.logs || []) {
      // Check if log is from FLOWER contract
      const logAddress = log.address?.toLowerCase();
      const isFlowerContract = (logAddress === FLOWER_CONTRACT_BASE.toLowerCase() || 
                               logAddress === FLOWER_CONTRACT_RONIN.toLowerCase());
      
      if (isFlowerContract && log.topics?.length >= 3) {
        // Topic[0] = Transfer event signature
        // Topic[1] = from address (indexed)
        // Topic[2] = to address (indexed)
        // Data = amount (uint256)
        
        const fromAddressRaw = log.topics[1];
        const toAddressRaw = log.topics[2];
        
        // Extract addresses from topics (remove padding)
        fromAddress = '0x' + fromAddressRaw.slice(-40);
        const toAddressLog = '0x' + toAddressRaw.slice(-40);
        
        // Check if to address matches our payment address
        if (toAddressLog.toLowerCase() === PAYMENT_ADDRESS.toLowerCase()) {
          // Parse token amount from data (hex to decimal)
          if (log.data && log.data !== '0x') {
            const amountHex = log.data;
            const amountWei = BigInt(amountHex);
            // FLOWER has 18 decimals (like most ERC-20)
            const decimals = BigInt(1e18);
            const amountHuman = Number(amountWei / decimals);
            tokenAmount = amountHuman;
        }
      }
    }

    if (tokenAmount === null) {
      return { success: false, error: 'No FLOWER transfer found in transaction' };
    }

    return {
      success: true,
      amount: tokenAmount,
      from: fromAddress,
      network,
      txHash
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check if an address is a valid EVM address
 */
function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Get current block number (for debugging)
 */
async function getBlockNumber(network = 'base') {
  const rpcUrl = network === 'base' ? ALCHEMY_BASE : ALCHEMY_RONIN;
  
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      })
    });
    
    const data = await resp.json();
    return data.result ? parseInt(data.result, 16) : null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  verifyFlowerPayment,
  detectNetwork,
  isValidAddress,
  getBlockNumber,
  ALCHEMY_BASE,
  ALCHEMY_RONIN
};