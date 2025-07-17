const express = require('express');
const db = require('./db'); // Import your database functions

const transactionsRoutes = require('./routes/transactions'); // Import your transaction routes
const blocksRoutes = require('./routes/blocks'); // Import your block routes
const network = require('./routes/network'); // Import your network routes

// const axios = require('axios'); // For making HTTP requests to other nodes
const cors = require('cors'); // For handling Cross-Origin Resource Sharing

const app = express();
const PORT = process.argv[2]; // Use environment variable 
const theProj = process.argv[4];

// Middleware
app.use(cors()); // Enable CORS for all routes (important for React frontend)
app.use(express.json()); // Enable parsing of JSON request bodies

// Routes
app.use('/api/transactions', transactionsRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/network', network.router);

// Basic root route
app.get('/', (req, res) => {
    res.send(`Welcome to the Blockchain Node API! \n Nodes in the network: ${network.networkNodes.join(', ')} \n Node ID: ${theProj}`);
});

// Error handling middleware (optional, but good practice)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server and initialize the database
async function startServer() {
    try {
        await db.initDb(); // Initialize database connection
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Access at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1); // Exit if DB connection fails
    }
}

// Start the application
startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await db.closeDb(); // Close database connection
    process.exit(0);
});