const authService = require('./authService');

// Signup Controller
const signupController = async (req, res) => {
  try {
    const { firstName, lastName, email, password, userType } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !userType) {
      return res.status(400).json({ 
        success: false,
        error: 'All fields are required' 
      });
    }
    
    const result = await authService.signup(firstName, lastName, email, password, userType);
    
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      ...result
    });

  } catch (error) {
    console.error('❌ Signup error:', error.message);
    
    // Return specific error message
    res.status(400).json({ 
      success: false,
      error: error.message
    });
  }
};

// Login Controller
const loginController = async (req, res) => {
  try {
    const { email, password, userType } = req.body;

    // Validate required fields
    if (!email || !password || !userType) {
      return res.status(400).json({ 
        success: false,
        error: 'Email, password, and account type are required' 
      });
    }
    
    const result = await authService.login(email, password, userType);
    
    res.json({
      success: true,
      message: 'Login successful',
      ...result
    });

  } catch (error) {
    console.error('❌ Login error:', error.message);
    
    // Return specific error message
    res.status(401).json({ 
      success: false,
      error: error.message
    });
  }
};

// Get Current User Controller
const getCurrentUserController = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: 'No authentication token provided' 
      });
    }

    const { decoded } = authService.verifyToken(token);
    const result = await authService.getUserById(decoded.userId);
    
    res.json(result);

  } catch (error) {
    console.error('❌ Get user error:', error.message);
    res.status(401).json({ 
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  signupController,
  loginController,
  getCurrentUserController
};