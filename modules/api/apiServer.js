// modules/api/apiServer.js
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

// Controllers
const dbController = require('../../App/Http/Controllers/databaseController');
const authController = require('../../App/Http/Controllers/authController');
const mauiController = require('../../App/Http/Controllers/mauiController');
const recordsController = require('../../App/Http/Controllers/recordsController');

class APIServer {
    constructor(database) {
        this.app = express();
        this.database = database;
        this.server = null;
        this.port = process.env.API_PORT || 3001;
        
        this.setupMiddleware();
        this.initializeControllers();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors({ origin: '*' }));
        this.app.use(bodyParser.json({ limit: '10mb' }));
        this.app.use('/records', express.static(path.join(__dirname, '../../records'), {
            setHeaders(res, filePath) {
                res.setHeader('Cache-Control', 'no-store');
                const name = path.basename(filePath);
                if (res.req.query.download === '1' && ['session.csv', 'dashboard.webm', 'dashboard.mp4', 'plot.png'].includes(name)) {
                    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
                }
            }
        }));
    }

    initializeControllers() {
        dbController.initializeController(this.database);
        authController.initializeController(this.database);
    }

    setupRoutes() {
        // Authentication Routes (Only Login is permitted; registration is handled via database seeder/admin)
        this.app.post('/api/auth/login', authController.login);

        // Data Routes
        this.app.get('/api/sensor-data', dbController.getSensorData);
        this.app.post('/api/sensor-data', dbController.insertSensorData);
        this.app.post('/api/maui-data', mauiController.genericDataHandler);

        // Fermentation Session Recorder (CSV export + python plot)
        this.app.post('/api/records', recordsController.createRecord);
        this.app.get('/api/records', recordsController.listRecords);
        const { recordingStore, recordingAction, localRecorder } = recordsController;
        this.app.post('/api/recordings', localRecorder, recordingAction((req) => recordingStore.start(req.body)));
        this.app.post('/api/recordings/:id/events/:sequence', localRecorder,
            recordingAction((req) => recordingStore.append(req.params.id, 'events', Number(req.params.sequence), req.body.events)));
        this.app.post('/api/recordings/:id/video/:sequence', localRecorder,
            express.raw({ type: 'application/octet-stream', limit: '2mb' }),
            recordingAction((req) => recordingStore.append(req.params.id, 'video', Number(req.params.sequence), req.body)));
        this.app.post('/api/recordings/:id/stop', localRecorder,
            recordingAction((req) => recordingStore.finish(req.params.id, req.body)));
        this.app.post('/api/recordings/:id/plot', localRecorder, recordsController.generatePlot);

        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({ 
                success: true, 
                message: 'API server is running',
                mode: process.env.USE_FIREBASE === 'true' ? 'Firebase' : 'MySQL/Standalone',
                websocketPort: process.env.WEBSOCKET_PORT || process.env.WS_PORT || '8080',
                timestamp: new Date().toISOString()
            });
        });
    }

    start() {
        this.server = this.app.listen(this.port, () => {
            console.log(`🚀 API server listening at http://localhost:${this.port}`);
        });
    }

    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('API server stopped');
                    resolve();
                });
            });
        }
    }

    getApp() {
        return this.app;
    }

    getPort() {
        return this.port;
    }
}

module.exports = APIServer;
