// main.js - Main entry point
require('dotenv').config();
const { app } = require('electron');

// Import modular components
const DatabaseManager = require('./modules/database/databaseManager');
const WindowManager = require('./modules/window/windowManager');
const APIServer = require('./modules/api/apiServer');
const SerialManager = require('./modules/serial/serialManager');
const IPCManager = require('./modules/ipc/ipcManager');
const WebsocketManager = require('./modules/websocket/websocketManager');
const MixerBridge = require('./lib/com/mixerBridge');

class Application {
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
        
        try {
            // Initialize in dependency order
            await this._initializeDatabase();
            this._initializeWindow();
            await this._initializeServices();
            this._setupIPC();
            
            this.isInitialized = true;
            console.log('🚀 Application initialized successfully');
        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            await this.cleanup();
            app.quit();
        }
    }

    async _initializeDatabase() {
        this.managers.database = new DatabaseManager();
        await this.managers.database.initialize();
        console.log('✅ Database ready');
    }

    _initializeWindow() {
        this.managers.window = new WindowManager();
        this.managers.window.createWindow();
        console.log('✅ Window ready');
    }

    async _initializeServices() {
        const db = this.managers.database.getDatabase();
        const mainWindow = this.managers.window.getMainWindow();

        // Initialize services concurrently
        const servicePromises = [
            this._initializeAPI(db),
            process.env.USE_SERIAL === 'true' ? this._initializeSerial(db, mainWindow) : Promise.resolve(),
            process.env.USE_WS === 'true' ? this._initializeWebSocket(db, mainWindow) : Promise.resolve()
        ];

        await Promise.all(servicePromises);
        console.log('✅ All services ready');
    }

    async _initializeAPI(db) {
        this.managers.api = new APIServer(db);
        this.managers.api.start();
    }

    async _initializeSerial(db, mainWindow) {
        // Relay Fermentor Kopi USB console frames to dashboard WebSocket clients
        // (websocket manager initializes in parallel, so look it up per frame)
        this.managers.serial = new SerialManager(db, mainWindow, {
            onMixer: (message) => this.mixer.receive(message),
            onConnection: (state) => this.mixer.connectionChanged(state),
            onFrame: (frame) => this.managers.websocket?.broadcastToAll({ type: 'sensor_update', data: frame }),
            onEvent: (event) => this.managers.websocket?.broadcastToAll({ type: 'device_log', data: event })
        });
        await this.managers.serial.initialize();
    }

    async _initializeWebSocket(db, mainWindow) {
        this.managers.websocket = new WebsocketManager(db, mainWindow, this.mixer);
        await this.managers.websocket.initialize();
    }

    _setupIPC() {
        this.managers.ipc = new IPCManager(
            this.managers.database.getDatabase(),
            this.managers.serial,
            this.managers.websocket // Pass websocket manager to IPC
        );
        this.managers.ipc.setupHandlers();
        console.log('✅ IPC handlers ready');
    }

    async cleanup() {
        if (!this.isInitialized) return;
        
        console.log('🔄 Starting cleanup...');
        const cleanupPromises = [];

        // Cleanup in reverse dependency order
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
        console.log('✅ Cleanup completed');
    }

    // Public API for accessing managers
    getManager(type) {
        return this.managers[type] || null;
    }
}

// Application instance
const app_instance = new Application();

// Electron event handlers - clean and compact
app.whenReady().then(() => app_instance.initialize());

app.on('window-all-closed', async () => {
    await app_instance.cleanup();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (require('electron').BrowserWindow.getAllWindows().length === 0) {
        app_instance.initialize();
    }
});

// Graceful shutdown on process signals
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await app_instance.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await app_instance.cleanup();
    process.exit(0);
});

module.exports = app_instance;
