// backend/api/authService.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

// JWT Secret - should be in .env file
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Generate JWT token
const generateToken = (userId, userType) => {
  return jwt.sign(
    { userId, userType },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { decoded };
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

// Signup service
const signup = async (firstName, lastName, email, password, userType) => {
  try {
    // Validate input
    if (!firstName || !lastName || !email || !password || !userType) {
      throw new Error('All fields are required');
    }

    // Validate email is Gmail
    if (!email.toLowerCase().endsWith('@gmail.com')) {
      throw new Error('Email must be a Gmail address (@gmail.com)');
    }

    // Validate password length
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    // Validate user type
    if (!['patient', 'clinician'].includes(userType)) {
      throw new Error('Invalid user type. Must be either patient or clinician');
    }

    // Check if user already exists with this email
    const existingUser = await pool.query(
      'SELECT id, email, user_type FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('An account with this email already exists. Please login instead.');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (user_type, first_name, last_name, email, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_type, first_name, last_name, email, created_at`,
      [userType, firstName, lastName, email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = generateToken(user.id, user.user_type);

    // Format patient/clinician ID
    const formattedId = `${user.user_type === 'patient' ? 'PAI' : 'CLI'}-${user.id.toString().padStart(5, '0')}`;

    console.log('✅ User registered successfully:', user.email);

    // Return user data
    return {
      success: true,
      token,
      user: {
        id: user.id,
        patientId: formattedId,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        userType: user.user_type,
        createdAt: user.created_at
      }
    };
  } catch (error) {
    console.error('❌ Signup error:', error.message);
    throw error;
  }
};

// Login service
const login = async (email, password, userType) => {
  try {
    // Validate input
    if (!email || !password || !userType) {
      throw new Error('Email, password, and account type are required');
    }

    // Validate user type
    if (!['patient', 'clinician'].includes(userType)) {
      throw new Error('Invalid account type selected');
    }

    // First, check if user exists with this email
    const userCheck = await pool.query(
      'SELECT id, email, user_type FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // If no user found at all
    if (userCheck.rows.length === 0) {
      throw new Error('No account found with this email. Please check your email or sign up.');
    }

    // Check if user exists but with different user type
    if (userCheck.rows[0].user_type !== userType) {
      const actualType = userCheck.rows[0].user_type;
      const displayType = actualType.charAt(0).toUpperCase() + actualType.slice(1);
      throw new Error(`This email is registered as a ${displayType}. Please select the correct account type.`);
    }

    // Get full user data including password
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND user_type = $2',
      [email.toLowerCase(), userType]
    );

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      throw new Error('Incorrect password. Please try again.');
    }

    // Generate JWT token
    const token = generateToken(user.id, user.user_type);

    // Format patient/clinician ID
    const formattedId = `${user.user_type === 'patient' ? 'PAI' : 'CLI'}-${user.id.toString().padStart(5, '0')}`;

    console.log('✅ User logged in successfully:', user.email);

    // Return user data
    return {
      success: true,
      token,
      user: {
        id: user.id,
        patientId: formattedId,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        userType: user.user_type,
      }
    };
  } catch (error) {
    console.error('❌ Login error:', error.message);
    throw error;
  }
};

// Get user by ID
const getUserById = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT id, user_type, first_name, last_name, email, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];

    // Format patient/clinician ID
    const formattedId = `${user.user_type === 'patient' ? 'PAI' : 'CLI'}-${user.id.toString().padStart(5, '0')}`;

    return {
      success: true,
      user: {
        id: user.id,
        patientId: formattedId,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        userType: user.user_type,
        createdAt: user.created_at
      }
    };
  } catch (error) {
    console.error('❌ Get user error:', error.message);
    throw error;
  }
};

module.exports = {
  signup,
  login,
  getUserById,
  verifyToken,
  generateToken
};