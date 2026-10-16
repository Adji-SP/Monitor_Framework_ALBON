// server.js - Standalone Node.js Backend Server for ALBON Framework
require('dotenv').config();

const DatabaseManager = require('./modules/database/databaseManager');
const APIServer = require('./modules/api/apiServer');
const SerialManager = require('./modules/serial/serialManager');
const WebsocketManager = require('./modules/websocket/websocketManager');
const MixerBridge = require('./lib/com/mixerBridge');

class StandaloneServer {
    constructor() {
        this.managers = {};
        this.mixer = new MixerBridge({
            getSerial: () => this.managers.serial,
            broadcast: (message) => this.managers.websocket?.broadcastToAll(message)
        });
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        console.log('\n======================================================');
        console.log('⚡ Starting ALBON Backend Server (Standalone Mode)...');
        console.log('======================================================\n');

        try {
            // 1. Initialize Database Manager
            this.managers.database = new DatabaseManager();
            await this.managers.database.initialize();
            const db = this.managers.database.getDatabase();
            console.log('✅ Database Manager ready');

            // 2. Initialize API Server (Express REST API)
            this.managers.api = new APIServer(db);
            this.managers.api.start();

            // 3. Initialize WebSocket Server
            if (process.env.USE_WS !== 'false') {
                this.managers.websocket = new WebsocketManager(db, null, this.mixer);
                await this.managers.websocket.initialize();
                console.log('✅ WebSocket Manager ready');
            }

            // 4. Initialize Serial Communication (if configured)
            if (process.env.USE_SERIAL === 'true') {
                // Relay Fermentor Kopi USB console frames to dashboard WebSocket clients
                const ws = this.managers.websocket;
                this.managers.serial = new SerialManager(db, null, {
                    onMixer: (message) => this.mixer.receive(message),
                    onConnection: (state) => this.mixer.connectionChanged(state),
                    onFrame: (frame) => ws && ws.broadcastToAll({ type: 'sensor_update', data: frame }),
                    onEvent: (event) => ws && ws.broadcastToAll({ type: 'device_log', data: event })
                });
                await this.managers.serial.initialize();
                console.log('✅ Serial Manager ready');
            }

            this.isInitialized = true;
            console.log('\n------------------------------------------------------');
            console.log(`🌐 Express API Server running on : http://localhost:${this.managers.api.getPort()}`);
            console.log(`💬 WebSocket Server running on : ws://localhost:${process.env.WEBSOCKET_PORT || process.env.WS_PORT || 8080}`);
            console.log('------------------------------------------------------\n');
        } catch (error) {
            console.error('❌ Standalone Server initialization failed:', error);
            await this.cleanup();
            process.exit(1);
        }
    }

    async cleanup() {
        if (!this.isInitialized) return;

        console.log('\n🔄 Shutting down server gracefully...');
        const cleanupPromises = [];

        if (this.managers.websocket) {
            cleanupPromises.push(this.managers.websocket.cleanup().catch(console.error));
        }
        if (this.managers.serial) {
            cleanupPromises.push(this.managers.serial.close().catch(console.error));
        }
        if (this.managers.api) {
            cleanupPromises.push(this.managers.api.stop().catch(console.error));
        }
        if (this.managers.database) {
            cleanupPromises.push(this.managers.database.close().catch(console.error));
        }

        await Promise.allSettled(cleanupPromises);
        this.isInitialized = false;
        console.log('✅ All backend services closed cleanly.');
    }
}

const serverInstance = new StandaloneServer();
serverInstance.initialize();

process.on('SIGINT', async () => {
    await serverInstance.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await serverInstance.cleanup();
    process.exit(0);
});
