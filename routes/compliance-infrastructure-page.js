const express = require('express');
const path = require('path');
const router = express.Router();
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');

router.get('/app/infrastructure', attachDemoSession, requireAuthOrDemo, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'compliance-infrastructure.html'));
});

module.exports = router;
