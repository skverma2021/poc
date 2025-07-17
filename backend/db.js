// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const sha256 = require('sha256');
const { v4: uuidv4 } = require('uuid');
const theProj = process.argv[4]; // Get the project ID from command line arguments
const fileName = process.argv[5]; 

// Define the path for the SQLite database file.
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
            if (err) return reject(err);

            console.log(`Connected to SQLite database at ${DB_FILE}`);

            const ensureBchain = `CREATE TABLE IF NOT EXISTS bchain (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                transactions TEXT NOT NULL,
                nonce INTEGER NOT NULL,
                hash TEXT NOT NULL,
                previousBlockHash TEXT NOT NULL,
                merkleRoot TEXT NOT NULL
            )`;

            const ensureTransactions = `CREATE TABLE IF NOT EXISTS transactions (
                transaction_id TEXT UNIQUE NOT NULL,
                projId INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                submitter_id TEXT NOT NULL,
                station_id TEXT,
                so2 REAL,
                no2 REAL,
                pm10 REAL,
                pm2_5 REAL,
                raw_data_json TEXT NOT NULL,
                rowHash TEXT NOT NULL
            )`;

            // Ensure both tables exist first
            db.run(ensureBchain, (err) => {
                if (err) return reject(err);
                console.log('Table "bchain" ensured to exist.');

                db.run(ensureTransactions, (err) => {
                    if (err) return reject(err);
                    console.log('Table "transactions" ensured to exist.');

                    // Now check for Genesis Block
                    const genesisCheck = `SELECT COUNT(*) AS count FROM bchain`;
                    db.get(genesisCheck, [], (err, row) => {
                        if (err) return reject(err);

                        if (row.count > 0) {
                            console.log('Genesis Block already exists.');
                            resolve(db);
                        } else {
                            console.log('Creating Genesis Block...');
                            const insertGenesis = `
                                INSERT INTO bchain (timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                                VALUES (?, ?, ?, ?, ?, ?)
                            `;
                            const values = [Date.now().toString(), '', 100, '0', '0', ''];
                            db.run(insertGenesis, values, function (err) {
                                if (err) return reject(err);
                                console.log('Genesis Block created.');
                                resolve(db);
                            });
                        }
                    });
                });
            });
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
            submitterId,
            stationID,
            SO2,
            NO2,
            PM10,
            PM2_5
        } = transactionData;

        const timestamp = Date.now(); // Use ISO format for consistency
        const rawDataJson = JSON.stringify(transactionData);
        const transactionId = uuidv4().split('-').join(''); // Generate a unique transaction ID
        const transactionHash = sha256(transactionId+timestamp+JSON.stringify(transactionData)); // Generate a hash of the transaction data

        const sql = `INSERT INTO transactions
                     (projId,transaction_id, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                     VALUES (?,?, ?, ?, ?, ?, ?, ?, ?, ?,?)`;
        db.run(sql, [
            theProj, // Use the project ID from command line arguments
            transactionId, // Unique transaction ID
            timestamp,
            submitterId,
            stationID,
            SO2,
            NO2,
            PM10,
            PM2_5,
            rawDataJson, // Store the full transaction data as JSON
            transactionHash // Store the hash of the transaction data
        ], function (err) {
            if (err) {
                console.error('Error inserting transaction:', err.message);
                reject(err);
            } else {
                // console.log(`A row has been inserted with ID: ${this.lastID}`);
                console.log(`A row has been inserted with ID: ${transactionId}`);
                resolve({ transactionId, rawDataJson,transactionHash, ...transactionData });
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
                    fullData: JSON.parse(row.raw_data_json),
                    rowHash: row.rowHash
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