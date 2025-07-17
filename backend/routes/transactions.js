// routes/transactions.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Import your database functions
const network = require('./network');
const axios = require('axios');

// POST /api/transactions
// Creates a new transaction record
router.post('/', async (req, res) => {
    try {
        const transactionData = req.body;

        // --- IMPORTANT: Add your blockchain validation logic here ---
        // Before creating the transaction in SQLite, you would:
        // 1. Calculate the hash of the transactionData.
        // 2. Get the hash of the previous block from your 'blocks' table.
        // 3. Construct a new 'block' object (or modify transactionData to include block-specific info).
        // 4. Perform cryptographic validation (e.g., check previousHash, calculate new block hash).
        // 5. Perform compliance rule validation on transactionData (e.g., SO2 limits).
        //    As discussed, non-compliance usually doesn't prevent inclusion, but might be flagged.

        // For this CRUD example, we'll directly create the transaction in the DB.
        // In a real blockchain, this would be part of the 'addBlock' process.

        const newTransaction = await db.createTransaction(transactionData);
        res.status(201).json({
            message: 'Transaction added successfully',
            transaction: newTransaction
        });
    } catch (error) {
        console.error('Error in POST /api/transactions:', error.message);
        // Handle unique constraint violation for transaction_id
        if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: transactions.transaction_id')) {
            return res.status(409).json({ error: 'Transaction ID already exists.' });
        }
        res.status(500).json({ error: 'Failed to add transaction.' });
    }
});

router.post('/broadcast', async function (req, res) {
    const transactionData = req.body;
	try {
        await db.createTransaction(transactionData);
		// Prepare POST requests to all other nodes in the network
		const broadcastPromises = network.networkNodes.map(networkNodeUrl => {
			return axios.post(networkNodeUrl + '/transactions', transactionData);
		});

		// Wait for all requests to finish
		await Promise.all(broadcastPromises);

		res.json({ note: 'Transaction created and broadcast successfully.' });
	} catch (error) {
		console.error('Broadcast failed:', error.message);
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