// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // Use Node's built-in crypto module for sha256
const { v4: uuidv4 } = require('uuid');

let theProj; // Stores the project ID (0 for RegAuth, 1 for ProjA, etc.)
let fileName; // Stores the database file name (e.g., projA.db)
let DB_FILE_PATH; // Stores the full path to the SQLite database file

// Global database instance for this module
let db;

/**
 * Sets the project ID for the current node. This is used when inserting transactions.
 * @param {string|number} projId The ID of the project/node.
 */
function setProjId(projId) {
    theProj = projId;
}

/**
 * Sets the database file name and ensures the 'data' directory exists.
 * This must be called before initDb().
 * @param {string} fname The name of the database file (e.g., 'projA.db').
 */
function setDbFile(fname) {
    fileName = fname;
    DB_FILE_PATH = path.join(__dirname, 'data', fileName);
    console.log(`Using database file at: ${DB_FILE_PATH}`);

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
        console.log(`Created data directory: ${dataDir}`);
    }
}

/**
 * Initializes the database connection and creates 'bchain', 'mempool_transactions',
 * and 'confirmed_transactions' tables if they do not exist.
 * Ensures a genesis block exists in 'bchain' for Regulator (projId '0').
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

            // Enable foreign key constraints
            db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
                if (pragmaErr) {
                    console.error('Error enabling foreign keys:', pragmaErr.message);
                    return reject(pragmaErr);
                }
                console.log('Foreign key enforcement enabled.');
            });

            // 1. Create 'bchain' table for blocks
            const ensureBchain = `CREATE TABLE IF NOT EXISTS bchain (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blockIndex INTEGER NOT NULL UNIQUE,
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
                projId TEXT NOT NULL, -- Changed to TEXT to match process.argv[4] type
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
                block_id INTEGER NOT NULL, -- Foreign key to bchain.id
                projId TEXT NOT NULL, -- Changed to TEXT to match process.argv[4] type
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

                // Check and create Genesis Block (only for RegAuth, projId '0')
                // This check should ideally be in initDb on ALL nodes, but only for RegAuth should it create.
                // Other nodes will receive the genesis block from RegAuth.
                db.get(`SELECT COUNT(*) AS count FROM bchain`, [], (err, row) => {
                    if (err) { console.error('Error checking genesis block:', err.message); return reject(err); }

                    if (row.count > 0) {
                        console.log('Genesis Block already exists.');
                        resolve(db);
                    } else if (theProj === '0') { // Only RegAuth (ID '0') creates the genesis block
                        console.log('Creating Genesis Block for Regulator node...');
                        const genesisBlock = {
                            blockIndex: 0,
                            timestamp: new Date().toISOString(),
                            transactions: '[]', // No actual transactions in genesis block
                            nonce: 0,
                            hash: crypto.createHash('sha256').update('regulator_genesis_block_v1').digest('hex'), // A unique, fixed hash for genesis
                            previousBlockHash: '0', // Standard for genesis
                            merkleRoot: crypto.createHash('sha256').update('genesis_merkle_root_v1').digest('hex') // Merkle root for empty transactions
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
                    } else {
                        // For non-RegAuth nodes, genesis block will be received from RegAuth
                        console.log('No genesis block found. Awaiting genesis block from RegAuth node.');
                        resolve(db);
                    }
                });
            });
        });
    });
}

// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------

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
        if (!theProj) {
            return reject(new Error("Project ID not set. Call setProjId() first."));
        }

        const timestamp = new Date().toISOString();

        // Destructure only the necessary fields for storage, ensure all are included.
        // It's safer to use a comprehensive list of fields to avoid missing data.
        const { submitterId, stationID, SO2, NO2, PM10, PM2_5 } = transactionData;

        const transactionId = uuidv4().split('-').join('');
        const dataToHash = transactionId + timestamp + JSON.stringify(transactionData);
        const transactionHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

        const rawDataJson = JSON.stringify(transactionData);

        const sql = `INSERT INTO mempool_transactions
                     (projId, transaction_id, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(sql, [
            theProj, // Use the project ID set by setProjId
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
                // Resolve with the complete transaction data, including generated IDs/hashes
                resolve({ transactionId, timestamp, rowHash: transactionHash, projId: theProj, ...transactionData });
            }
        });
    });
}

// -----------------------------------------------------------------------------

/**
 * Reads (Retrieves) all transaction records from the **confirmed_transactions** table.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of transaction objects.
 */
function readAllTransactions() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        const sql = `SELECT * FROM confirmed_transactions ORDER BY timestamp DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error reading confirmed transactions:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => ({
                    internal_id: row.internal_id,
                    transactionId: row.transaction_id,
                    block_id: row.block_id, // Link to the block it belongs to
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

// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------

/**
 * Retrieves a specified number of transactions from the **mempool_transactions** for block creation.
 * Returns the full transaction objects, parsed from raw_data_json.
 * @param {number} limit The maximum number of transactions to retrieve.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of transactions.
 */
function getTransactionsForBlock(limit) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }
        // Order by timestamp to get the oldest transactions first (FIFO)
        db.all(`SELECT * FROM mempool_transactions ORDER BY timestamp ASC LIMIT ?`, [limit], (err, rows) => {
            if (err) {
                console.error('Error getting transactions for block:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => {
                    // Reconstruct the full transaction object, including the generated IDs/hashes
                    const fullTx = JSON.parse(row.raw_data_json);
                    return {
                        ...fullTx,
                        transactionId: row.transaction_id,
                        projId: row.projId,
                        timestamp: row.timestamp, // Use the stored timestamp for consistency
                        rowHash: row.rowHash
                    };
                });
                resolve(transactions);
            }
        });
    });
}

// -----------------------------------------------------------------------------

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
        // Create a string of placeholders for the IN clause: ?, ?, ?
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

// -----------------------------------------------------------------------------

/**
 * Adds a confirmed block to the 'bchain' table and its transactions to 'confirmed_transactions'.
 * This operation is wrapped in a database transaction for atomicity.
 * @param {Object} block The block object to add, including its transactions array.
 * @returns {Promise<Object>} A promise that resolves with the added block.
 */
function addBlockToBlockchain(block) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Database not initialized. Call initDb() first."));
        }

        const { blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot } = block;

        // Store a lightweight representation of transactions in the block metadata (e.g., just IDs and hashes)
        const lightweightTransactions = transactions.map(tx => ({
            transactionId: tx.transactionId,
            rowHash: tx.rowHash
        }));
        const transactionsJson = JSON.stringify(lightweightTransactions);

        db.serialize(() => { // Use serialize to ensure sequential operations within this section
            db.run("BEGIN TRANSACTION;", (beginErr) => {
                if (beginErr) {
                    console.error('Error beginning transaction:', beginErr.message);
                    return reject(beginErr);
                }
            });

            // 1. Insert block metadata into 'bchain' table
            const insertBlockSql = `INSERT INTO bchain
                                    (blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.run(insertBlockSql, [
                blockIndex,
                timestamp,
                transactionsJson,
                nonce,
                hash,
                previousBlockHash,
                merkleRoot
            ], function(err) {
                if (err) {
                    db.run("ROLLBACK;", () => console.error('Transaction rolled back due to block insertion error.'));
                    console.error('Error inserting block into bchain:', err.message);
                    return reject(err);
                }
                const block_id = this.lastID; // Get the ID of the newly inserted block in 'bchain'

                // 2. Insert each transaction into the 'confirmed_transactions' table
                const insertTxPromises = transactions.map(tx => {
                    return new Promise((res, rej) => {
                        // Ensure all necessary fields are available in the 'tx' object
                        const { transactionId, projId, timestamp, submitterId, stationID, SO2, NO2, PM10, PM2_5, rawDataJson, rowHash } = tx;
                        const sql = `INSERT INTO confirmed_transactions
                                     (transaction_id, block_id, projId, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                        db.run(sql, [
                            transactionId, block_id, projId, timestamp, submitterId, stationID, SO2, NO2, PM10, PM2_5, rawDataJson, rowHash
                        ], function(txErr) {
                            if (txErr) rej(txErr);
                            else res();
                        });
                    });
                });

                Promise.all(insertTxPromises)
                    .then(() => {
                        // 3. Commit the database transaction
                        db.run("COMMIT;", (commitErr) => {
                            if (commitErr) {
                                console.error('Error committing block transaction:', commitErr.message);
                                db.run("ROLLBACK;", () => console.error('Transaction rolled back due to commit error.'));
                                reject(commitErr);
                            } else {
                                console.log(`Block (index ${blockIndex}) added to blockchain with ${transactions.length} transactions and committed.`);
                                resolve(block);
                            }
                        });
                    })
                    .catch(insertErr => {
                        console.error('Error inserting confirmed transactions:', insertErr.message);
                        db.run("ROLLBACK;", () => console.error('Transaction rolled back due to confirmed transactions insertion error.'));
                        reject(insertErr);
                    });
            });
        });
    });
}

// -----------------------------------------------------------------------------

/**
 * Gets the last block from the 'bchain' table.
 * @returns {Promise<Object|null>} A promise that resolves with the last block object, or null if no blocks exist.
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
                    // Parse the transactions JSON string back into an array of objects
                    row.transactions = JSON.parse(row.transactions);
                    resolve(row);
                } else {
                    // This case should ideally not happen if Genesis block is always created for RegAuth
                    resolve(null);
                }
            }
        });
    });
}

// -----------------------------------------------------------------------------

module.exports = {
    initDb,
    closeDb,
    setProjId,
    setDbFile,
    createTransaction,
    readAllTransactions,
    getMempoolCount,
    getTransactionsForBlock,
    removeTransactionsFromMempool,
    addBlockToBlockchain,
    getLastBlock,
};