const express = require('express');
const db = require('./db'); // Import your database functions
const transactionsRoutes = require('./routes/transactions'); // Import your transaction routes
const cors = require('cors'); // For handling Cross-Origin Resource Sharing

const app = express();
const PORT = process.env.PORT || 3000; // Use environment variable or default to 3000

// Middleware
app.use(cors()); // Enable CORS for all routes (important for React frontend)
app.use(express.json()); // Enable parsing of JSON request bodies

// Routes
app.use('/api/transactions', transactionsRoutes);

// Basic root route
app.get('/', (req, res) => {
    res.send('Welcome to the Blockchain Node API! Use /api/transactions for operations.');
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