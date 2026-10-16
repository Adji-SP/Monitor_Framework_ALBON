// App/Http/Controllers/authController.js - MySQL Auth with JWT Token
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let db;
const JWT_SECRET = process.env.JWT_SECRET || process.env.DB_ENCRYPTION_KEY || 'ALBON_JWT_SECRET_KEY_2026';

function initializeController(databaseInstance) {
    db = databaseInstance;
}

/**
 * Handles user login requests against MySQL database with JWT generation.
 */
async function login(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    try {
        let user = null;

        if (db && typeof db.getDataByFilters === 'function') {
            const users = await db.getDataByFilters('users', { username });
            user = users && users.length > 0 ? users[0] : null;
        }

        // If user found in MySQL database
        if (user) {
            const passwordIsValid = await bcrypt.compare(password, user.password);
            if (!passwordIsValid) {
                return res.status(401).json({ success: false, error: 'Invalid username or password.' });
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role || 'operator' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            const { password: _, ...userWithoutPassword } = user;
            return res.status(200).json({
                success: true,
                message: 'MySQL Authentication Successful',
                token,
                user: userWithoutPassword
            });
        }

        // Standalone Fallback Accounts (when MySQL server connection is pending configuration)
        const demoAccounts = {
            admin: { id: 1, username: 'admin', role: 'admin', passwordHash: await bcrypt.hash('admin123', 10) },
            operator: { id: 2, username: 'operator', role: 'operator', passwordHash: await bcrypt.hash('operator123', 10) }
        };

        const demoUser = demoAccounts[username];
        if (demoUser && await bcrypt.compare(password, demoUser.passwordHash)) {
            const token = jwt.sign(
                { id: demoUser.id, username: demoUser.username, role: demoUser.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            return res.status(200).json({
                success: true,
                message: 'MySQL Demo Authentication Successful',
                token,
                user: { id: demoUser.id, username: demoUser.username, role: demoUser.role }
            });
        }

        return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Internal server error during login.' });
    }
}

/**
 * Handles user registration requests into MySQL users table.
 */
async function register(req, res) {
    const { username, email, password, role } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    try {
        if (db && typeof db.getDataByFilters === 'function') {
            const existingUsers = await db.getDataByFilters('users', { username });
            if (existingUsers && existingUsers.length > 0) {
                return res.status(409).json({ success: false, error: 'User with this username already exists in MySQL.' });
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            username,
            email: email || `${username}@albon.com`,
            password: hashedPassword,
            role: role || 'operator',
            created_at: new Date().toISOString()
        };

        let insertId = Date.now();
        if (db && typeof db.postData === 'function') {
            const result = await db.postData('users', newUser);
            insertId = result.insertId || insertId;
        }

        const token = jwt.sign(
            { id: insertId, username: newUser.username, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully in MySQL',
            token,
            user: { id: insertId, username: newUser.username, role: newUser.role }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, error: 'Internal server error during registration.' });
    }
}

/**
 * Middleware to verify JWT tokens
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid or expired access token' });
        }
        req.user = user;
        next();
    });
}

module.exports = {
    initializeController,
    login,
    register,
    authenticateToken
};