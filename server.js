require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 4000;

// Hardcoded credentials
const ADMIN_USER = {
  email: 'admin@blimto.com',
  password: 'admin@124'
};

// Simple token for session (valid for 7 days)
const AUTH_SECRET = crypto.randomBytes(32).toString('hex');
const validTokens = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
  }
});

// Generate auth token
function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
  validTokens.set(token, { expiresAt });
  return { token, expiresAt };
}

// Verify token middleware
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const tokenData = validTokens.get(token);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    validTokens.delete(token);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  next();
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (email === ADMIN_USER.email && password === ADMIN_USER.password) {
    const { token, expiresAt } = generateToken();
    res.json({ success: true, token, expiresAt });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Verify token endpoint (for checking if still logged in)
app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;

  const tokenData = validTokens.get(token);
  if (tokenData && tokenData.expiresAt > Date.now()) {
    res.json({ valid: true });
  } else {
    validTokens.delete(token);
    res.json({ valid: false });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    validTokens.delete(token);
  }
  res.json({ success: true });
});

// API endpoint to execute SQL queries (protected)
app.post('/api/query', verifyToken, async (req, res) => {
  const { query } = req.body;

  if (!query || query.trim() === '') {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const startTime = Date.now();
    const result = await pool.query(query);
    const executionTime = Date.now() - startTime;

    res.json({
      success: true,
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields?.map(f => f.name) || [],
      executionTime: `${executionTime}ms`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// API endpoint to get topics with concept counts
app.get('/api/topics', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.id,
        t.topic,
        t.display_name,
        t.short_description,
        t.bg_color,
        t.logo_url,
        t.status,
        t.concepts_count,
        t.sort_order,
        COUNT(c.id) FILTER (WHERE c.status = 'active') AS active_count,
        COUNT(c.id) FILTER (WHERE c.status = 'under_review') AS under_review_count,
        COUNT(c.id) AS total_concepts
      FROM topics t
      LEFT JOIN concepts c ON c.topic_id = t.id
      GROUP BY t.id
      ORDER BY t.sort_order, t.display_name
    `);

    res.json({
      success: true,
      topics: result.rows
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// API endpoint to get bug users with status counts
app.get('/api/bug-users', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        "user",
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'done') AS done_count,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
        COUNT(*) FILTER (WHERE status = 'working') AS working_count,
        MAX(created_at) AS last_report
      FROM bugs
      GROUP BY "user"
      ORDER BY total DESC, "user"
    `);

    res.json({
      success: true,
      users: result.rows
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the main dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
