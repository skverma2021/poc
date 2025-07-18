// routes/transactions.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Import your database functions
const network = require('./network');
const axios = require('axios');

// POST /api/transactions
// This endpoint receives transactions from other nodes or the local UI
router.post('/', async (req, res) => { // This is the /api/transactions POST
    try {
        const transactionData = req.body;

        // Perform basic validation for the incoming transaction
        // (e.g., check required fields, data types)
        if (!transactionData.transactionId || !transactionData.timestamp || !transactionData.submitterId) {
             return res.status(400).json({ error: 'Missing mandatory transaction fields.' });
        }

        // --- IMPORTANT: Add your transaction-specific compliance validation here ---
        // For example, if SO2 is outside a range, you might log a warning
        // but still accept into mempool (as discussed for compliance-level errors).
        // If it's a structural or data type error, you'd reject.

        await db.createTransaction(transactionData); // This now inserts into mempool_transactions

        res.status(201).json({
            message: 'Transaction accepted into mempool.',
            transaction: transactionData
        });
    } catch (error) {
        console.error('Error in POST /api/transactions:', error.message);
        if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: mempool_transactions.transaction_id')) {
            return res.status(409).json({ error: 'Transaction ID already exists in mempool.' });
        }
        res.status(500).json({ error: 'Failed to accept transaction.' });
    }
});


// POST /api/transactions/broadcast
// This route is called by a node to submit its own transaction and broadcast it
// to other nodes' /api/transactions endpoints.
router.post('/broadcast', async function (req, res) {
    const transactionData = req.body;
    try {
        // First, add the transaction to this node's own mempool
        await db.createTransaction(transactionData); // This also inserts into mempool_transactions

        // Then, prepare POST requests to all other known nodes to their /api/transactions endpoint
        const broadcastPromises = network.networkNodes.map(networkNodeUrl => {
            // Make sure the URL is correct, it should hit the /api/transactions endpoint on peers
            return axios.post(`${networkNodeUrl}/api/transactions`, transactionData);
        });

        await Promise.all(broadcastPromises);

        res.json({ note: 'Transaction created locally and broadcast successfully.' });
    } catch (error) {
        console.error('Transaction broadcast failed:', error.message);
        // Distinguish between local DB error and broadcast errors
        res.status(500).json({ note: 'Transaction broadcast failed.', error: error.message });
    }
});


// GET /api/transactions
// Retrieves all transaction records
router.get('/', async (req, res) => {
    try {
        const transactions = await db.readAllTransactions();
        res.status(200).json(transactions);
    } catch (error) {
        console.error('Error in GET /api/transactions:', error.message);
        res.status(500).json({ error: 'Failed to retrieve transactions.' });
    }
});

module.exports = router;