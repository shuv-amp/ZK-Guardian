const express = require('express');
const { 
  signupController, 
  loginController, 
  getCurrentUserController 
} = require('./authController');

const router = express.Router();

// Signup route
router.post('/signup', signupController);

// Login route
router.post('/login', loginController);

// Get current user route
router.get('/me', getCurrentUserController);

module.exports = router;