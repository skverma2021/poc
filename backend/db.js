// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // Use Node's built-in crypto module for sha256
const { v4: uuidv4 } = require('uuid');

// These should ideally be passed in or derived from a config, not global process.argv
// For now, let's keep them as is for direct compatibility with your existing snippets.
let theProj; // Will be set by setProjId
let fileName; // Will be set by setDbFile

let DB_FILE_PATH; // This variable will hold the full path to the DB file

function setProjId(projId) {
    theProj = projId;
}

function setDbFile(fname) {
    fileName = fname;
    DB_FILE_PATH = path.join(__dirname, 'data', fileName);
    console.log(`Using database file at: ${DB_FILE_PATH}`);

    // Ensure the 'data' directory exists when the file path is set
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
}


let db; // Global database instance for this module

/**
 * Initializes the database connection and creates the 'bchain', 'mempool_transactions', and 'confirmed_transactions' tables if they do not exist.
 * Ensures a genesis block exists in 'bchain'.
 * @returns {Promise<sqlite3.Database>} A promise that resolves with the database object.
 */
function initDb() {
    return new Promise((resolve, reject) => {
        if (!DB_FILE_PATH) {
            return reject(new Error("Database file path not set. Call setDbFile() first."));
        }

        db = new sqlite3.Database(DB_FILE_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                return reject(err);
            }
            console.log(`Connected to SQLite database at ${DB_FILE_PATH}`);

            // 1. Create 'bchain' table for blocks
            const ensureBchain = `CREATE TABLE IF NOT EXISTS bchain (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blockIndex INTEGER NOT NULL UNIQUE, -- Added unique index for easy retrieval
                timestamp TEXT NOT NULL,
                transactions TEXT NOT NULL, -- JSON string of transaction IDs/hashes in the block
                nonce INTEGER NOT NULL,
                hash TEXT NOT NULL,
                previousBlockHash TEXT NOT NULL,
                merkleRoot TEXT NOT NULL
            )`;

            // 2. Create 'mempool_transactions' table for unconfirmed transactions
            const ensureMempoolTransactions = `CREATE TABLE IF NOT EXISTS mempool_transactions (
                internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT UNIQUE NOT NULL, -- This is your UUID
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

            // 3. Create 'confirmed_transactions' table for transactions that are on the blockchain
            const ensureConfirmedTransactions = `CREATE TABLE IF NOT EXISTS confirmed_transactions (
                internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT UNIQUE NOT NULL, -- This is your UUID
                block_id INTEGER NOT NULL, -- Foreign key to bchain.id (optional, but good for linking)
                projId INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                submitter_id TEXT NOT NULL,
                station_id TEXT,
                so2 REAL,
                no2 REAL,
                pm10 REAL,
                pm2_5 REAL,
                raw_data_json TEXT NOT NULL,
                rowHash TEXT NOT NULL,
                FOREIGN KEY (block_id) REFERENCES bchain(id)
            )`;

            // Execute all table creations sequentially
            db.serialize(() => {
                db.run(ensureBchain, (err) => {
                    if (err) { console.error('Error creating bchain table:', err.message); return reject(err); }
                    console.log('Table "bchain" ensured to exist.');
                });
                db.run(ensureMempoolTransactions, (err) => {
                    if (err) { console.error('Error creating mempool_transactions table:', err.message); return reject(err); }
                    console.log('Table "mempool_transactions" ensured to exist.');
                });
                db.run(ensureConfirmedTransactions, (err) => {
                    if (err) { console.error('Error creating confirmed_transactions table:', err.message); return reject(err); }
                    console.log('Table "confirmed_transactions" ensured to exist.');
                });

                // Check and create Genesis Block
                db.get(`SELECT COUNT(*) AS count FROM bchain`, [], (err, row) => {
                    if (err) { console.error('Error checking genesis block:', err.message); return reject(err); }

                    if (row.count > 0) {
                        console.log('Genesis Block already exists.');
                        resolve(db);
                    } else {
                        console.log('Creating Genesis Block...');
                        // Genesis block details (adjust as needed for your actual block structure)
                        const genesisBlock = {
                            blockIndex: 0, // Genesis block is index 0
                            timestamp: Date.now().toString(),
                            transactions: '[]', // Empty array of transactions for genesis
                            nonce: 0, // No PoW for PoA
                            hash: crypto.createHash('sha256').update('genesis_block_data').digest('hex'), // A unique hash for genesis
                            previousBlockHash: '0', // Standard for genesis
                            merkleRoot: crypto.createHash('sha256').update('genesis_merkle_root').digest('hex') // Merkle root for empty transactions
                        };

                        const insertGenesis = `
                            INSERT INTO bchain (blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `;
                        db.run(insertGenesis, [
                            genesisBlock.blockIndex,
                            genesisBlock.timestamp,
                            genesisBlock.transactions,
                            genesisBlock.nonce,
                            genesisBlock.hash,
                            genesisBlock.previousBlockHash,
                            genesisBlock.merkleRoot
                        ], function (err) {
                            if (err) { console.error('Error creating Genesis Block:', err.message); return reject(err); }
                            console.log('Genesis Block created.');
                            resolve(db);
                        });
                    }
                });
            });
        });
    });
}

// ... (closeDb function remains the same) ...
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
 * Creates (Inserts) a new transaction record into the **mempool_transactions** table.
 * @param {Object} transactionData The transaction object to insert.
 * @returns {Promise<Object>} A promise that resolves with the inserted transaction data.
 */
function createTransaction(transactionData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }

        const timestamp = new Date().toISOString(); // Using ISO string for consistency

        // Destructure only the necessary fields for storage
        const { submitterId, stationID, SO2, NO2, PM10, PM2_5 } = transactionData;

        // Generate unique ID and hash for the transaction
        const transactionId = uuidv4().split('-').join('');
        const dataToHash = transactionId + timestamp + JSON.stringify(transactionData);
        const transactionHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

        const rawDataJson = JSON.stringify(transactionData);

        const sql = `INSERT INTO mempool_transactions
                     (projId, transaction_id, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(sql, [
            theProj,
            transactionId,
            timestamp,
            submitterId,
            stationID,
            SO2,
            NO2,
            PM10,
            PM2_5,
            rawDataJson,
            transactionHash
        ], function (err) {
            if (err) {
                console.error('Error inserting transaction into mempool:', err.message);
                reject(err);
            } else {
                console.log(`Transaction inserted into mempool with ID: ${transactionId}`);
                // Resolve with the complete transaction data as it would be added to mempool
                resolve({ transactionId, timestamp, rawDataJson, rowHash: transactionHash, ...transactionData });
            }
        });
    });
}

/**
 * Reads (Retrieves) all transaction records from the **confirmed_transactions** table.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of transaction objects.
 */
function readAllTransactions() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        // Changed to read from confirmed_transactions
        const sql = `SELECT * FROM confirmed_transactions ORDER BY timestamp DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error reading confirmed transactions:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => ({
                    internal_id: row.internal_id, // Renamed from 'id' to avoid confusion with transaction_id
                    transactionId: row.transaction_id,
                    block_id: row.block_id,
                    projId: row.projId,
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


// --- New functions for mempool and block management (modified to use new tables) ---

/**
 * Gets the current count of transactions in the **mempool_transactions** table.
 * @returns {Promise<number>} A promise that resolves with the count.
 */
function getMempoolCount() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        db.get(`SELECT COUNT(*) AS count FROM mempool_transactions`, (err, row) => {
            if (err) {
                console.error('Error getting mempool count:', err.message);
                reject(err);
            } else {
                resolve(row.count);
            }
        });
    });
}

/**
 * Retrieves a specified number of transactions from the **mempool_transactions** for block creation.
 * Returns raw data objects as they were stored in the mempool.
 * @param {number} limit The maximum number of transactions to retrieve.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of transactions.
 */
function getTransactionsForBlock(limit) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        db.all(`SELECT * FROM mempool_transactions ORDER BY timestamp ASC LIMIT ?`, [limit], (err, rows) => {
            if (err) {
                console.error('Error getting transactions for block:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => {
                    // Return the full transaction object as needed for Merkle tree and block data
                    return JSON.parse(row.raw_data_json);
                });
                resolve(transactions);
            }
        });
    });
}

/**
 * Removes transactions from the **mempool_transactions** after they have been included in a block.
 * @param {Array<string>} transactionIds An array of transactionId strings to remove.
 * @returns {Promise<number>} A promise that resolves with the number of rows deleted.
 */
function removeTransactionsFromMempool(transactionIds) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        if (transactionIds.length === 0) {
            return resolve(0);
        }
        const placeholders = transactionIds.map(() => '?').join(',');
        db.run(`DELETE FROM mempool_transactions WHERE transaction_id IN (${placeholders})`, transactionIds, function(err) {
            if (err) {
                console.error('Error removing transactions from mempool:', err.message);
                reject(err);
            } else {
                console.log(`Removed ${this.changes} transactions from mempool.`);
                resolve(this.changes);
            }
        });
    });
}


/**
 * Adds a confirmed block to the 'bchain' table and its transactions to 'confirmed_transactions'.
 * @param {Object} block The block object to add.
 * @returns {Promise<Object>} A promise that resolves with the added block.
 */
function addBlockToBlockchain(block) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }

        const { blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot } = block;
        const transactionsJson = JSON.stringify(transactions.map(tx => ({
            transactionId: tx.transactionId,
            rowHash: tx.rowHash // Ensure these are part of the original transaction objects
        }))); // Store only relevant parts or full raw data if needed

        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");

            // Insert block metadata into 'bchain' table
            const insertBlockSql = `INSERT INTO bchain
                                    (blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.run(insertBlockSql, [
                blockIndex,
                timestamp,
                transactionsJson, // Storing serialized transactions
                nonce,
                hash,
                previousBlockHash,
                merkleRoot
            ], function(err) {
                if (err) {
                    db.run("ROLLBACK;");
                    console.error('Error inserting block into bchain:', err.message);
                    return reject(err);
                }
                const block_id = this.lastID; // Get the ID of the newly inserted block

                // Insert each transaction into the 'confirmed_transactions' table
                const insertTxPromises = transactions.map(tx => {
                    return new Promise((res, rej) => {
                        const { transactionId, projId, timestamp, submitterId, stationID, SO2, NO2, PM10, PM2_5, rawDataJson, rowHash } = tx; // Ensure all these are present in the transaction object from getTransactionsForBlock
                        const sql = `INSERT INTO confirmed_transactions
                                     (transaction_id, block_id, projId, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                        db.run(sql, [
                            transactionId, block_id, projId, timestamp, submitterId, stationID, SO2, NO2, PM10, PM2_5, rawDataJson, rowHash
                        ], function(err) {
                            if (err) rej(err);
                            else res();
                        });
                    });
                });

                Promise.all(insertTxPromises)
                    .then(() => {
                        db.run("COMMIT;", (commitErr) => {
                            if (commitErr) {
                                console.error('Error committing block transaction:', commitErr.message);
                                db.run("ROLLBACK;");
                                reject(commitErr);
                            } else {
                                console.log(`Block (index ${blockIndex}) added to blockchain with ${transactions.length} transactions and committed.`);
                                resolve(block);
                            }
                        });
                    })
                    .catch(insertErr => {
                        console.error('Error inserting confirmed transactions:', insertErr.message);
                        db.run("ROLLBACK;");
                        reject(insertErr);
                    });
            });
        });
    });
}

/**
 * Gets the last block from the 'bchain' table.
 * @returns {Promise<Object>} A promise that resolves with the last block object, or null if no blocks exist.
 */
function getLastBlock() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        db.get(`SELECT * FROM bchain ORDER BY blockIndex DESC LIMIT 1`, (err, row) => {
            if (err) {
                console.error('Error getting last block:', err.message);
                reject(err);
            } else {
                if (row) {
                    // Parse the transactions JSON back into an array if needed
                    row.transactions = JSON.parse(row.transactions);
                    resolve(row);
                } else {
                    // This case should ideally not happen if Genesis block is always created
                    resolve(null);
                }
            }
        });
    });
}


module.exports = {
    initDb,
    closeDb,
    setProjId, // Export new setter
    setDbFile, // Export new setter
    createTransaction, // Now inserts into mempool
    readAllTransactions, // Now reads from confirmed transactions
    getMempoolCount,
    getTransactionsForBlock,
    removeTransactionsFromMempool,
    addBlockToBlockchain,
    getLastBlock,
};


/**
 * Closes the database connection.
 * @returns {Promise<void>} A promise that resolves when the database is closed.
 */
// function closeDb() {
//     return new Promise((resolve, reject) => {
//         if (db) {
//             db.close((err) => {
//                 if (err) {
//                     console.error('Error closing database:', err.message);
//                     reject(err);
//                 } else {
//                     console.log('Database connection closed.');
//                     resolve();
//                 }
//             });
//         } else {
//             resolve(); // No database open
//         }
//     });
// }