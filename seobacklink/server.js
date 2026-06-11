require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// Raw body for Stripe webhook verification must come before json middleware
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/backlinks', require('./routes/backlinks'));
app.use('/api/visibility', require('./routes/visibility'));
app.use('/api', require('./routes/api'));
app.use('/api/webhooks', require('./routes/stripe-webhooks'));
app.use('/', require('./routes/pages'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SeoBacklink running on port ${PORT}`));
