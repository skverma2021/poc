// routes/transactions.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Import your database functions
const network = require('./network');
const axios = require('axios');
const crypto = require('crypto'); // Used for re-hashing received transactions

// This endpoint is for RECEIVING a transaction that has been broadcast from a peer node.
// The transaction object received here is expected to be complete and fully formed.
router.post('/receive', async (req, res) => {
    console.log('Received transaction for processing...');
    try {
        const transactionData = req.body;

        // Validation for a received transaction: It should already have an ID and a hash.
        // This prevents malicious or malformed transactions from being added to the mempool.
        if (!transactionData.transactionId || !transactionData.timestamp || !transactionData.rowHash) {
            console.error('Received transaction is missing mandatory fields. Rejecting.');
            return res.status(400).json({ error: 'Missing mandatory transaction fields for reception.' });
        }
        console.log('Passed Check-1');

        // Optional: Re-validate the hash to ensure the transaction hasn't been tampered with.
        // const dataToHash = transactionData.transactionId + transactionData.timestamp + JSON.stringify(transactionData.fullData || transactionData);
        // const dataToHash = transactionData.transactionId + transactionData.timestamp + JSON.stringify(transactionData);
        // const reCalculatedHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
        const dataToHash = transactionData.transactionId + transactionData.timestamp + transactionData.rawDataJson;
        const reCalculatedHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
        console.log(reCalculatedHash, transactionData.rowHash);
        if (reCalculatedHash !== transactionData.rowHash) {
            console.error('Received transaction hash mismatch. Rejecting.');
            return res.status(400).json({ error: 'Transaction hash mismatch. Data may be corrupted.' });
        }
        console.log('Passed Check-2');

        // Add the received transaction to this node's mempool.
        await db.createTransaction(transactionData); 

        res.status(201).json({
            message: 'Transaction received and accepted into mempool.',
            transaction: transactionData
        });
    } catch (error) {
        console.error('Error in POST /api/transactions/receive:', error.message);
        if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: mempool_transactions.transaction_id')) {
            return res.status(409).json({ error: 'Transaction ID already exists in mempool.' });
        }
        res.status(500).json({ error: 'Failed to accept received transaction.' });
    }
});

// router.post('/receive', async (req, res) => {
//     console.log('*** RECEIVED REQUEST ON /api/transactions/receive ***');
//     console.log('Request Body:', req.body); // Log the full body
//     return res.status(200).json({ message: 'Transaction received OK (DEBUGGING MODE)' });
// });


// This endpoint is for a client (your local API or a user interface) to SUBMIT a new, raw transaction.
// This route is the starting point for a new transaction on the network.
router.post('/submit', async function (req, res) {
    console.log('Hi-1!')
    const rawTransactionData = req.body;
    try {
        // 1. Add the transaction to this node's own mempool.
        // The db.createTransaction() function will handle the generation of ID, timestamp, and hash.
        const newTransaction = await db.createTransaction(rawTransactionData);
        console.log('Hi-3!');
        console.log(network.networkNodes)
        // 2. Prepare POST requests to all other known nodes to their '/receive' endpoint.
        const broadcastPromises = network.networkNodes.map(networkNodeUrl => {
            console.log(`${networkNodeUrl}/transactions/receive`, newTransaction)
            return axios.post(`${networkNodeUrl}/transactions/receive`, newTransaction);
        });

        // 3. Wait for all broadcast requests to finish.
        await Promise.all(broadcastPromises);

        // axios.post(`http://localhost:3003/transactions/receive`, newTransaction);

        // 4. Respond to the client after the local creation and broadcast are successful.
        res.status(201).json({ 
            note: 'Transaction created locally and broadcast successfully.', 
            transaction: newTransaction 
        });

    } catch (error) {
        console.error('Transaction submission and broadcast failed:', error.message);
        // console.error('Transaction submission and broadcast failed:', error);
        res.status(500).json({ 
            note: 'Transaction broadcast failed.', 
            error: error.message 
        });
    }
});

// A route to get all confirmed transactions from the confirmed_transactions table.
router.get('/', async (req, res) => {
    try {
        const transactions = await db.readAllTransactions();
        res.status(200).json({ transactions });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve transactions.' });
    }
});

module.exports = router;