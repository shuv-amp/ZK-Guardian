// backend/server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const authRoutes = require('./api/authRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration for Expo
const corsOptions = {
  origin: '*',
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check - Root level
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Server is running', 
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API base route - NEW!
app.get('/api', (req, res) => {
  res.json({ 
    success: true,
    message: 'API is running',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        // Add other auth endpoints you have
      }
    },
    timestamp: new Date()
  });
});

// Health check - API level
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Server is running', 
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Routes
app.use('/api/auth', authRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Route not found' 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false,
    error: 'Something went wrong!' 
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📱 For Expo: http://192.168.1.67:${PORT}/api`);
  console.log(`💻 Local: http://localhost:${PORT}/api`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
});