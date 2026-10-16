// App/Http/Controllers/databaseController.js
let db;

function initializeController(databaseInstance) {
    db = databaseInstance;
}

async function getSensorData(req, res) {
    try {
        if (db && typeof db.getData === 'function') {
            const data = await db.getData('sensor_data', {}, 50);
            return res.json({ success: true, data });
        }
        // Fallback mock / sample data if database connection is pending
        const mockData = [
            { id: 1, user_id: 'USR01', device_id: 'FERM_ESP32', ph_reading: '6.45', temperature_reading: '28.4', moisture_percentage: '65.2', timestamp: new Date(Date.now() - 300000).toISOString() },
            { id: 2, user_id: 'USR01', device_id: 'FERM_ESP32', ph_reading: '6.50', temperature_reading: '28.6', moisture_percentage: '64.8', timestamp: new Date(Date.now() - 150000).toISOString() },
            { id: 3, user_id: 'USR01', device_id: 'FERM_ESP32', ph_reading: '6.52', temperature_reading: '28.5', moisture_percentage: '65.0', timestamp: new Date().toISOString() }
        ];
        return res.json({ success: true, data: mockData, source: 'standalone-fallback' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}

async function insertSensorData(req, res) {
    const { user_id, device_id, ph_reading, temperature_reading, moisture_percentage } = req.body;

    try {
        if (!db) {
            return res.json({ success: true, id: Date.now(), message: "Data received via API (Mock mode - DB not connected)." });
        }

        if (db.validate) {
            db.validate(req.body, {
                user_id: ['required'],
                device_id: ['required']
            });
        }

        const payload = {
            user_id: user_id || 'USR_WEB',
            device_id: device_id || 'REACT_APP',
            ph_reading: db.encrypt ? db.encrypt(String(ph_reading || '7.0')) : String(ph_reading || '7.0'),
            temperature_reading: db.encrypt ? db.encrypt(String(temperature_reading || '25.0')) : String(temperature_reading || '25.0'),
            moisture_percentage: db.encrypt ? db.encrypt(String(moisture_percentage || '60.0')) : String(moisture_percentage || '60.0'),
            created_at: new Date().toISOString()
        };

        const result = await db.postData('sensor_data', payload);
        res.json({ success: true, id: result.insertId || Date.now(), message: "Data received via API and saved." });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
}

module.exports = {
    initializeController,
    getSensorData,
    insertSensorData
};