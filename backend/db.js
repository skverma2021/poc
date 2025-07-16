// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const fileName = process.argv[5]; 
const theProj = process.argv[4]; // Get the project ID from command line arguments

// Define the path for the SQLite database file.
// For different nodes (A, X, B, Y), you would change this path
// or pass it as an environment variable/config.
const DB_FILE = path.join(__dirname, 'data', fileName); // Centralized DB file for this node
console.log(`Using database file at: ${DB_FILE}`);

// Ensure the 'data' directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

let db; // Global database instance for this module

/**
 * Initializes the database connection and creates the 'bchain and transactions' tables if they do not exist.
 * @returns {Promise<sqlite3.Database>} A promise that resolves with the database object.
 */
function initDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_FILE, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
            } else {
                console.log(`Connected to the SQLite database at ${DB_FILE}`);
                db.run(`CREATE TABLE IF NOT EXISTS bchain (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    transactions TEXT NOT NULL,
                    nonce INTEGER NOT NULL,
                    hash TEXT NOT NULL,
                    previousBlockHash TEXT NOT NULL,
                    merkleRoot TEXT NOT NULL
                )`, (createErr) => {
                    if (createErr) {
                        console.error('Error creating table:', createErr.message);
                        reject(createErr);
                    } else {
                        console.log('Table "bchain" ensured to exist.');
                        // Create the Genesis Block if it doesn't exist
                        const genesisSql = `SELECT COUNT(*) AS count FROM bchain`;
                        db.get(genesisSql, [], (genesisErr, row) => {
                            if (genesisErr) {
                                console.error('Error checking Genesis Block:', genesisErr.message);
                                reject(genesisErr);
                            } else if (row.count > 0) {
                                console.log('Genesis Block already exists.');
                            } else {
                                console.log('Creating Genesis Block...');
                                // Insert the Genesis Block
                                const sql = `INSERT INTO bchain
                                    (timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                                    VALUES (${Date.now()}, '', 100, 0, 0, '' )`;
                                db.run(sql, []
                                    , function (err) {
                                        if (err) {
                                            console.error('Error creating Genesis Block:', err.message);
                                            reject(err);
                                        } else {
                                            console.log(`Genesis Block created `);
                                            resolve(row);
                                        }
                                    });
                            }
                        });
                        resolve(db);
                    }
                });

                db.run(`CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    projId INTEGER NOT NULL DEFAULT 1, -- Assuming projId is always 1 for this node
                    transaction_id TEXT UNIQUE NOT NULL,
                    timestamp TEXT NOT NULL,
                    submitter_id TEXT NOT NULL,
                    station_id TEXT,
                    so2 REAL,
                    no2 REAL,
                    pm10 REAL,
                    pm2_5 REAL,
                    raw_data_json TEXT NOT NULL,
                    rowHash TEXT NOT NULL
                )`, (createErr) => {
                    if (createErr) {
                        console.error('Error creating table:', createErr.message);
                        reject(createErr);
                    } else {
                        console.log('Table "transactions" ensured to exist.');
                        resolve(db);
                    }
                });
            }
        });
    });
}

/**
 * Closes the database connection.
 * @returns {Promise<void>} A promise that resolves when the database is closed.
 */
function closeDb() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                    reject(err);
                } else {
                    console.log('Database connection closed.');
                    resolve();
                }
            });
        } else {
            resolve(); // No database open
        }
    });
}


/**
 * Creates (Inserts) a new transaction record.
 * @param {Object} transactionData The transaction object to insert.
 * @returns {Promise<Object>} A promise that resolves with the inserted transaction data including its DB ID.
 */
function createTransaction(transactionData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }

        const {
            transactionId,
            timestamp,
            submitterId,
            stationID,
            SO2,
            NO2,
            PM10,
            PM2_5
        } = transactionData;

        const rawDataJson = JSON.stringify(transactionData);

        const sql = `INSERT INTO transactions
                     (projId,transaction_id, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                     VALUES (?,?, ?, ?, ?, ?, ?, ?, ?, ?,?)`;

        db.run(sql, [
            theProj, // Use the project ID from command line arguments
            transactionId,
            timestamp,
            submitterId,
            stationID,
            SO2,
            NO2,
            PM10,
            PM2_5,
            rawDataJson,
            ''
        ], function (err) {
            if (err) {
                console.error('Error inserting transaction:', err.message);
                reject(err);
            } else {
                console.log(`A row has been inserted with ID: ${this.lastID}`);
                resolve({ id: this.lastID, ...transactionData });
            }
        });
    });
}

/**
 * Reads (Retrieves) all transaction records.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of transaction objects.
 */
function readAllTransactions() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        const sql = `SELECT * FROM transactions ORDER BY timestamp DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error reading transactions:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => ({
                    id: row.id,
                    transactionId: row.transaction_id,
                    timestamp: row.timestamp,
                    submitterId: row.submitter_id,
                    stationID: row.station_id,
                    SO2: row.so2,
                    NO2: row.no2,
                    PM10: row.pm10,
                    PM2_5: row.pm2_5,
                    // Optionally parse the full data if needed for display
                    fullData: JSON.parse(row.raw_data_json)
                }));
                resolve(transactions);
            }
        });
    });
}

// Export functions for use in other modules
module.exports = {
    initDb,
    closeDb,
    createTransaction,
    readAllTransactions,
    // You can add readTransactionById, updateTransaction, deleteTransaction here if needed by routes
};