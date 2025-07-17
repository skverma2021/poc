const express = require('express');
const router = express.Router();
const db = require('../db'); // Import your database functions

const crypto = require('crypto');

/**
 * Generate SHA-256 hash.
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the Merkle Root from an array of transaction hashes.
 * @param {string[]} hashes - An array of transaction hashes.
 * @returns {string} The Merkle Root.
 */
function getMerkleRoot(hashes) {
    if (hashes.length === 0) return '';

    while (hashes.length > 1) {
        if (hashes.length % 2 !== 0) {
            // Duplicate last hash if odd number of elements
            hashes.push(hashes[hashes.length - 1]);
        }

        const newLevel = [];
        for (let i = 0; i < hashes.length; i += 2) {
            const combined = hashes[i] + hashes[i + 1];
            newLevel.push(sha256(combined));
        }

        hashes = newLevel;
    }

    return hashes[0];
}


module.exports = router;