const express = require('express');
const router = express.Router();
const {readAllTransactions} = require('../bchain/in-sql');

router.get('/blockchain', async (req, res) => {
    console.log("Hi")
    try {
        const bChain = readAllTransactions()
        res.send(bChain)
    } catch (error) {
        console.log("Error")
    }
    
  
});

module.exports = router;