const router = require('express').Router();
const path = require('path');

const pages = ['/', '/pricing', '/login', '/register', '/dashboard', '/articles', '/backlinks', '/visibility', '/settings', '/reset-password'];

const fileMap = {
  '/': 'index.html',
  '/pricing': 'pricing.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/dashboard': 'dashboard.html',
  '/articles': 'articles.html',
  '/backlinks': 'backlinks.html',
  '/visibility': 'visibility.html',
  '/settings': 'settings.html',
  '/reset-password': 'reset-password.html',
};

pages.forEach(p => {
  router.get(p, (req, res) => {
    res.sendFile(path.join(__dirname, '../public', fileMap[p]));
  });
});

module.exports = router;
