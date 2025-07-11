const express = require('express');
const router = express.Router();
const Blockchain = require('../bchain/in-mem');

const bitcoin = new Blockchain();

router.get('/blockchain', (req, res) => {
  res.send(bitcoin)
});
module.exports = router;