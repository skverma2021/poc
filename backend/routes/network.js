const express = require('express');
const router = express.Router();
// const db = require('../db'); // Import your database functions
const axios = require('axios');

const myNodeUrl = process.argv[3]; // e.g. http://localhost:3001
let networkNodes = []; // All known peer nodes (excluding self)


router.post('/register-and-broadcast-node', (req, res) => {
    console.log('Registering and broadcasting new node...');
    const newNodeUrl = req.body.newNodeUrl;
    if (!networkNodes.includes(newNodeUrl) && newNodeUrl !== myNodeUrl) {
        networkNodes.push(newNodeUrl);
    }

    // Broadcast this new node to all existing nodes
    const regPromises = networkNodes.map(existingNodeUrl => {
        return axios.post(`${existingNodeUrl}/network/register-node`, { newNodeUrl });
    });

    // Send list of all known nodes to the new node
    Promise.all(regPromises)
        .then(() => {
            return axios.post(`${newNodeUrl}/network/register-nodes-bulk`, {
                allNetworkNodes: [...networkNodes, myNodeUrl]
            });
        })
        .then(() => res.json({ note: 'New node registered with network.', nodeArray: networkNodes }))
        .catch(err => res.status(500).send(err.message));
});


router.post('/register-node', (req, res) => {
    const newNodeUrl = req.body.newNodeUrl;
    if (!networkNodes.includes(newNodeUrl) && newNodeUrl !== myNodeUrl) {
        networkNodes.push(newNodeUrl);
    }
    res.json({ note: 'Node registered.' });
});

router.post('/register-nodes-bulk', (req, res) => {
    const allNodes = req.body.allNetworkNodes;
    allNodes.forEach(nodeUrl => {
        if (!networkNodes.includes(nodeUrl) && nodeUrl !== myNodeUrl) {
            networkNodes.push(nodeUrl);
        }
    });
    res.json({ note: 'Bulk registration successful.' });
});
router.get('/consensus', async (req, res) => {
    try {
        const promises = networkNodes.map(nodeUrl => axios.get(`${nodeUrl}/blockchain`));
        const results = await Promise.all(promises);
        
        // Combine all blockchains
        const allChains = results.map(result => result.data.chain);
        // Here you would implement your consensus logic to determine the longest chain
        // For simplicity, let's assume we just return the first one
        const longestChain = allChains[0]; // Replace with actual consensus logic

        res.json({
            note: 'Consensus reached',
            chain: longestChain
        });
    } catch (error) {
        console.error('Error in /consensus:', error.message);
        res.status(500).json({ error: 'Failed to reach consensus.' });
    }
});


module.exports = {
    router,
    myNodeUrl,
    networkNodes
};