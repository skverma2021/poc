// index.js
const express = require('express');
const db = require('./db');
const transactionsRoutes = require('./routes/transactions');
const blocksRoutes = require('./routes/blocks'); // NEW: Import blocks routes
const network = require('./routes/network'); // Import network module
const cors = require('cors');

const app = express();
const PORT = process.argv[2] || 3000; // Port from package.json script
network.myNodeUrl = process.argv[3]; // Node URL from package.json script
const REG_AUTH_ID = process.argv[4]; // 0 for RegAuth, 1 for ProjA, 2 for ProjB etc.
const DB_FILE_NAME = process.argv[5] || 'default.db'; // DB file name from package.json

db.setProjId(REG_AUTH_ID);

// Set the DB_FILE in db.js dynamically based on node
db.setDbFile(DB_FILE_NAME); // You'll need to add a setDbFile function in db.js

const MINE_THRESHOLD = 100; // Transactions to trigger a mine (for RegAuth)
let mineInterval; // To store the interval timer

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/transactions', transactionsRoutes);
app.use('/api/blocks', blocksRoutes); // NEW: Use blocks routes
app.use('/api/network', network.router);

// Basic root route
app.get('/', (req, res) => {
    res.send(`Welcome to Node ${PORT}! Role: ${REG_AUTH_ID == 0 ? 'Regulator' : 'Project'}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server and initialize the database
async function startServer() {
    try {
        await db.initDb(); // Initialize database connection and tables

        // --- RegAuth Specific Mining Logic ---
        if (REG_AUTH_ID === '0') { // Only RegAuth (node with ID 0) mines
            console.log('RegAuth node. Starting mining check interval...');
            mineInterval = setInterval(async () => {
                try {
                    const mempoolCount = await db.getMempoolCount();
                    console.log(`RegAuth Mempool Count: ${mempoolCount}`);
                    if (mempoolCount >= MINE_THRESHOLD) {
                        console.log(`Mempool count reached ${MINE_THRESHOLD}. Triggering block mine...`);
                        // Trigger the /api/blocks/mine endpoint internally
                        // Since this is internal, we can directly call the handler function logic
                        await blocksRoutes.handleMineRequest(); // Needs to be exposed from blocksRoutes
                    }
                } catch (error) {
                    console.error('Error during mining check:', error.message);
                }
            }, 10 * 1000); // Check every 10 seconds (adjust as needed)
        }
        // --- End RegAuth Specific Logic ---

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Access at ${network.myNodeUrl}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}


// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    if (mineInterval) {
        clearInterval(mineInterval); // Clear the mining interval
    }
    await db.closeDb();
    process.exit(0);
});

startServer();