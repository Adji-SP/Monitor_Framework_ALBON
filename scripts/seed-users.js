// scripts/seed-users.js - MySQL User Seeder for ALBON Framework
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const defaultUsers = [
  {
    username: 'admin',
    email: 'admin@albon.com',
    password: 'admin123',
    role: 'admin'
  },
  {
    username: 'operator',
    email: 'operator@albon.com',
    password: 'operator123',
    role: 'operator'
  }
];

async function seedUsers() {
  console.log('\n======================================================');
  console.log('🌱 ALBON MySQL User Database Seeder');
  console.log('======================================================\n');

  const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'albon_db',
    port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306
  };

  try {
    console.log(`Connecting to MySQL database '${dbConfig.database}' at ${dbConfig.host}:${dbConfig.port}...`);
    const connection = await mysql.createConnection(dbConfig);

    // 1. Ensure users table exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(150) NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'operator',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ MySQL `users` table verified/created.');

    // 2. Seed initial users
    for (const u of defaultUsers) {
      const [rows] = await connection.execute('SELECT id FROM users WHERE username = ?', [u.username]);
      
      if (rows.length === 0) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        await connection.execute(
          'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
          [u.username, u.email, hashedPassword, u.role]
        );
        console.log(`👤 Seeded user: ${u.username} (${u.role}) -> Password: ${u.password}`);
      } else {
        console.log(`ℹ️ User '${u.username}' already exists. Skipping.`);
      }
    }

    await connection.end();
    console.log('\n✅ User Database Seeding Completed Successfully!\n');
  } catch (error) {
    console.warn('\n⚠️ MySQL Connection Warning:', error.message);
    console.log('ℹ️ In Standalone/Mock Mode, you can log in with:');
    console.log('   - Username: admin | Password: admin123 (Role: admin)');
    console.log('   - Username: operator | Password: operator123 (Role: operator)\n');
  }
}

seedUsers();
