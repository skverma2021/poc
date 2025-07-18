// routes/blocks.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const network = require('./network');
const axios = require('axios');
const crypto = require('crypto');

// --- Helper function for Merkle Tree (simplified, you might use a library) ---
function calculateMerkleRoot(transactions) {
    if (transactions.length === 0) return '0'; // Handle empty block
    let hashes = transactions.map(tx => crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex'));

    while (hashes.length > 1) {
        if (hashes.length % 2 !== 0) {
            hashes.push(hashes[hashes.length - 1]); // Duplicate last hash if odd number
        }
        let newHashes = [];
        for (let i = 0; i < hashes.length; i += 2) {
            newHashes.push(crypto.createHash('sha256').update(hashes[i] + hashes[i+1]).digest('hex'));
        }
        hashes = newHashes;
    }
    return hashes[0];
}

// --- The actual mining function ---
// This function will be called by the POST /mine endpoint AND internally by index.js
async function mineBlockInternal() {
    const BLOCK_SIZE = 100;

    const pendingTransactions = await db.getTransactionsForBlock(BLOCK_SIZE);

    if (pendingTransactions.length === 0) {
        console.log('No pending transactions to mine.');
        return { note: 'No pending transactions to mine.' }; // Return info
    }

    const previousBlockHash = await db.getLastBlock(); // Ensure this is correctly implemented

    const newBlock = {
        index: await db.getMempoolCount() + 1, // Simplified index
        timestamp: new Date().toISOString(),
        transactions: pendingTransactions,
        merkleRoot: calculateMerkleRoot(pendingTransactions),
        previousHash: previousBlockHash,
        nonce: 0,
        hash: ''
    };

    const blockString = newBlock.index + newBlock.timestamp + newBlock.merkleRoot + newBlock.previousHash + newBlock.nonce;
    newBlock.hash = crypto.createHash('sha256').update(blockString).digest('hex');

    await db.addBlockToBlockchain(newBlock);

    const confirmedTransactionIds = pendingTransactions.map(tx => tx.transactionId);
    await db.removeTransactionsFromMempool(confirmedTransactionIds);

    const broadcastPromises = network.networkNodes.map(networkNodeUrl => {
        return axios.post(`${networkNodeUrl}/api/blocks/receive`, { newBlock });
    });
    await Promise.all(broadcastPromises);

    return { note: 'Block mined and broadcast successfully.', block: newBlock };
}

// --- Express Routes ---

// POST /api/blocks/mine
router.post('/mine', async (req, res) => {
    try {
        const result = await mineBlockInternal();
        res.status(200).json(result);
    } catch (error) {
        console.error('Error in POST /api/blocks/mine:', error.message);
        res.status(500).json({ error: 'Failed to mine block.', details: error.message });
    }
});

// --- Block Reception and Validation Logic (For all nodes: A, B, RegAuth) ---
router.post('/receive', async (req, res) => {
    const { newBlock } = req.body;

    // 1. Basic validation (check if block structure is valid)
    if (!newBlock || !newBlock.index || !newBlock.timestamp || !newBlock.transactions || !newBlock.merkleRoot || !newBlock.previousHash || !newBlock.hash) {
        return res.status(400).json({ note: 'Received block is missing required fields.' });
    }

    try {
        // 2. Get the last block from THIS node's chain
        const lastBlockOnThisChainHash = await db.getLastBlock(); // Need to implement this

        // 3. Validate previous hash: Does it link correctly to our chain?
        if (newBlock.previousHash !== lastBlockOnThisChainHash) {
            return res.status(400).json({ note: 'Received block does not link correctly to our chain (previous hash mismatch).' });
        }

        // 4. Validate Merkle Root (optional, but good practice if you implement it)
        const receivedMerkleRoot = calculateMerkleRoot(newBlock.transactions);
        if (receivedMerkleRoot !== newBlock.merkleRoot) {
            console.warn(`Merkle Root mismatch for block ${newBlock.index}. Potential data tampering.`);
            return res.status(400).json({ note: 'Merkle Root mismatch, block rejected.' });
        }

        // 5. Re-calculate hash: Does the block hash match its content?
        const blockString = newBlock.index + newBlock.timestamp + newBlock.merkleRoot + newBlock.previousHash + newBlock.nonce;
        const reCalculatedHash = crypto.createHash('sha256').update(blockString).digest('hex');
        if (reCalculatedHash !== newBlock.hash) {
            console.warn(`Hash mismatch for block ${newBlock.index}. Potential data tampering.`);
            return res.status(400).json({ note: 'Block hash mismatch, block rejected.' });
        }

        // 6. Validate each transaction's compliance data (e.g., SO2 limits)
        // Loop through newBlock.transactions and call your validateTransactionData function (from previous discussions)
        // If any transaction fails compliance, you might flag it, or reject the whole block depending on your PoC rules.
        // For this PoC, let's assume block is accepted even if some transactions are non-compliant, just flagged.

        // 7. Add block to this node's blockchain
        await db.addBlockToBlockchain(newBlock);

        // 8. Remove confirmed transactions from this node's mempool
        const confirmedTransactionIds = newBlock.transactions.map(tx => tx.transactionId);
        await db.removeTransactionsFromMempool(confirmedTransactionIds);


        res.status(200).json({ note: 'Block received and accepted.' });

    } catch (error) {
        console.error('Error receiving block:', error.message);
        res.status(500).json({ error: 'Failed to process received block.', details: error.message });
    }
});


module.exports = router;