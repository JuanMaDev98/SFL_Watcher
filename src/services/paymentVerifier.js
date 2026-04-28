const { createClient } = require('@supabase/supabase-js');

const ALCHEMY_BASE = process.env.ALCHEMY_BASE_RPC || `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const ALCHEMY_RONIN = process.env.ALCHEMY_RONIN_RPC || `https://ronin-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;

const FLOWER_CONTRACT_BASE = '0x3E12b9d6A4D12cd9b4a6d613872d0Eb32f68b380';
const FLOWER_CONTRACT_RONIN = '0x3e12b9d6a4d12cd9b4a6d613872d0eb32f68b380';
const FLOWER_PAYMENT_ADDRESS = process.env.FLOWER_PAYMENT_ADDRESS || '0xbeA7Aa84316661BBC3963e2c5276d2Cd952D7806';
const FLOWER_DECIMALS = 18;

/**
 * Get Alchemy RPC URL for network
 */
function getAlchemyRpc(network) {
  return network === 'base' ? ALCHEMY_BASE : ALCHEMY_RONIN;
}

/**
 * Fetch from Alchemy JSON-RPC API
 */
async function alchemyFetch(network, method, params) {
  const rpc = getAlchemyRpc(network);
  try {
    const resp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const data = await resp.json();
    if (data.error) {
      console.error(`[alchemyFetch] ${method} error:`, data.error);
      return null;
    }
    return data.result;
  } catch (e) {
    console.error(`[alchemyFetch] ${method} network=${network}:`, e.message);
    return null;
  }
}

/**
 * Get FLOWER balance for an address (for ERC-20 transfer detection)
 */
async function getTokenTransfers(network, address, fromBlock = '0x0') {
  // ERC-20 Transfer event signature: Transfer(address,address,uint256)
  const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35b100';

  // Get logs for Transfer events where this address is the 'from'
  const logs = await alchemyFetch(network, 'eth_getLogs', [{
    address: network === 'base' ? FLOWER_CONTRACT_BASE : FLOWER_CONTRACT_RONIN,
    fromBlock,
    toBlock: 'latest',
    topics: [
      TRANSFER_TOPIC0,
      '0x000000000000000000000000' + address.slice(2).toLowerCase(), // from
      '0x000000000000000000000000' + FLOWER_PAYMENT_ADDRESS.slice(2).toLowerCase() // to (payment address)
    ]
  }]);

  return logs || [];
}

/**
 * Get native token (RON/ETH) transfers for an address
 */
async function getNativeTransfers(network, address, fromBlock = '0x0') {
  // eth_getLogs doesn't support value filtering directly, get all logs for this address as 'from'
  const logs = await alchemyFetch(network, 'eth_getLogs', [{
    fromBlock,
    toBlock: 'latest',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35b100' // Transfer topic (only works for ERC-20)
    ]
  }]);

  // For native token (RON/ETH), we need eth_getTransactionByHash after getting tx hashes from blocks
  // This is more complex - let's use eth_getLogs for standard Transfer events only for now
  return [];
}

/**
 * Get transaction receipt to verify ERC-20 Transfer
 */
async function getTransferReceipt(network, txHash) {
  const receipt = await alchemyFetch(network, 'eth_getTransactionReceipt', [txHash]);
  if (!receipt) return null;

  // Get transaction to check 'from' address and value
  const tx = await alchemyFetch(network, 'eth_getTransactionByHash', [txHash]);
  if (!tx) return null;

  return { receipt, tx };
}

/**
 * Verify FLOWER payment by checking user's wallet history
 * Returns { success, txHash, amount, network } if found
 */
async function verifyWalletPayment(userWalletAddress, requiredAmountFlower, networks = ['base', 'ronin']) {
  const requiredAmountWei = BigInt(Math.ceil(requiredAmountFlower * 10 ** FLOWER_DECIMALS));
  let partialInfo = null;

  for (const network of networks) {
    try {
      // Get all Transfer events from user wallet to payment address
      const logs = await getTokenTransfers(network, userWalletAddress);

      console.log(`[verifyWalletPayment] ${network}: found ${logs.length} transfer logs for ${userWalletAddress}`);

      for (const log of logs) {
        // Parse amount from log data
        // Topics: [ Transfer topic, from (indexed), to (indexed) ]
        // Data: amount (uint256)
        const amountHex = log.topics[3] || log.data;
        if (!amountHex || amountHex === '0x') continue;

        const amount = BigInt(amountHex);
        const amountFlower = Number(amount) / 10 ** FLOWER_DECIMALS;

        if (amount >= requiredAmountWei) {
          // Found a valid transfer
          // Get tx hash from log's transactionHash
          const txHash = log.transactionHash;
          const blockNum = log.blockNumber;
          const logIndex = log.logIndex;

          console.log(`[verifyWalletPayment] Found valid tx ${txHash}: ${amount} >= ${requiredAmountWei}`);

          return {
            success: true,
            txHash,
            amount: amountFlower,
            network,
            blockNumber: parseInt(blockNum, 16),
            logIndex: parseInt(logIndex, 16)
          };
        } else {
          // Found a transfer but insufficient amount
          // Keep track of the highest insufficient payment
          if (!partialInfo || amountFlower > partialInfo.amount) {
            partialInfo = {
              amount: amountFlower,
              network,
              txHash: log.transactionHash
            };
          }
        }
      }
    } catch (e) {
      console.error(`[verifyWalletPayment] ${network} error:`, e.message);
      continue;
    }
  }

  return { 
    success: false, 
    error: 'No matching payment found',
    partialPayment: partialInfo || null
  };
}

/**
 * Get recent transactions for an address (fallback method)
 */
async function getRecentTxs(network, address, maxCount = 10) {
  // Get latest block first
  const latestBlockHex = await alchemyFetch(network, 'eth_blockNumber', []);
  if (!latestBlockHex) return [];

  const latestBlock = parseInt(latestBlockHex, 16);
  const fromBlock = Math.max(0, latestBlock - 1000).toString(16); // Search last ~1000 blocks

  // Get logs for any Transfer to our payment address where 'from' includes this user
  const logs = await alchemyFetch(network, 'eth_getLogs', [{
    address: network === 'base' ? FLOWER_CONTRACT_BASE : FLOWER_CONTRACT_RONIN,
    fromBlock: '0x' + fromBlock,
    toBlock: 'latest',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35b100'
    ]
  }]);

  if (!logs || logs.length === 0) return [];

  // Filter logs where 'from' matches user wallet
  const userLogs = logs.filter(log => {
    const fromTopic = log.topics[1]; // indexed 'from' parameter
    if (!fromTopic) return false;
    // Remove padding: last 20 bytes of the 32-byte topic
    const fromAddress = '0x' + fromTopic.slice(fromTopic.length - 40);
    return fromAddress.toLowerCase() === address.toLowerCase();
  });

  // Extract unique tx hashes
  const txHashes = [...new Set(userLogs.map(log => log.transactionHash))];
  return txHashes.slice(0, maxCount);
}

/**
 * Verify a specific transaction by hash
 */
async function verifyTxHash(network, txHash) {
  const result = await getTransferReceipt(network, txHash);
  if (!result) return { success: false, error: 'Transaction not found' };

  const { receipt, tx } = result;

  // Verify transaction succeeded (status 1 = success)
  if (receipt.status !== '0x1') {
    return { success: false, error: 'Transaction failed' };
  }

  // Check it was to the payment address
  const toAddress = tx.to?.toLowerCase();
  const paymentAddress = FLOWER_PAYMENT_ADDRESS.toLowerCase();
  if (toAddress !== paymentAddress) {
    return { success: false, error: 'Transaction not to payment address' };
  }

  // Check it was from user's wallet
  const fromAddress = tx.from?.toLowerCase();

  // For ERC-20 transfers, we need to check logs for Transfer event with our payment address as 'to'
  // For native token (RON/ETH), the value is in tx.value

  // Check logs for ERC-20 Transfer event
  const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35b100';
  const paymentAddressPadded = '0x000000000000000000000000' + FLOWER_PAYMENT_ADDRESS.slice(2).toLowerCase();

  for (const log of receipt.logs) {
    if (log.topics[0] === TRANSFER_TOPIC0 && log.address.toLowerCase() === (network === 'base' ? FLOWER_CONTRACT_BASE : FLOWER_CONTRACT_RONIN).toLowerCase()) {
      // This is a Transfer event from an ERC-20 contract
      // Check if 'to' parameter matches our payment address
      const toTopic = log.topics[2];
      if (toTopic && toTopic.toLowerCase() === paymentAddressPadded.toLowerCase()) {
        const amountHex = log.topics[3] || log.data;
        const amount = Number(BigInt(amountHex || '0x0')) / 10 ** FLOWER_DECIMALS;
        return {
          success: true,
          txHash,
          amount,
          network,
          fromAddress,
          isErc20: true
        };
      }
    }
  }

  // Check for native token transfer (value in tx)
  const nativeValue = BigInt(tx.value || '0x0');
  if (nativeValue > 0n) {
    return {
      success: true,
      txHash,
      amount: Number(nativeValue) / 10 ** 18,
      network,
      fromAddress,
      isErc20: false
    };
  }

  return { success: false, error: 'No valid transfer found' };
}

module.exports = {
  verifyWalletPayment,
  verifyTxHash,
  getRecentTxs,
  getTokenTransfers,
  getTransferReceipt,
  getAlchemyRpc,
  FLOWER_PAYMENT_ADDRESS,
  FLOWER_CONTRACT_BASE,
  FLOWER_CONTRACT_RONIN
};
