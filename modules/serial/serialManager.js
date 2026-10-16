// modules/serial/serialManager.js
const SerialCommunicator = require('../../lib/com/serialCommunicator');

class SerialManager {
    // handlers: { onFrame(frame), onEvent(event) } for the 'fermentor-text' data type
    constructor(database, mainWindow, handlers = {}) {
        console.log('=== SerialManager Constructor ===');
        console.log('Database provided:', !!database);
        console.log('MainWindow provided:', !!mainWindow);

        this.database = database;
        this.mainWindow = mainWindow;
        this.serialCommunicator = null;
        this.config = { ...this.getSerialConfig(), ...handlers };

        console.log('Final SerialManager config:', JSON.stringify(this.config, null, 2));
        console.log('=== End SerialManager Constructor ===');
    }

    getSerialConfig() {
        // Helper function to properly parse escape sequences
        const parseLineDelimiter = (delimiter) => {
            if (!delimiter) return '\r\n'; // default

            // Replace common escape sequences
            return delimiter
                .replace(/\\r/g, '\r')
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                // Handle the case where it's just "r\n" without leading backslash
                .replace(/^r\\n$/, '\r\n')
                .replace(/^\\r\\n$/, '\r\n');
        };

        const rawDelimiter = process.env.SERIAL_LINE_DELIMITER || '\r\n';
        const parsedDelimiter = parseLineDelimiter(rawDelimiter);

        // "null" / empty in .env means auto-detect
        const rawPort = (process.env.SERIAL_PORT || '').trim();
        const portPath = rawPort && rawPort.toLowerCase() !== 'null' ? rawPort : null;

        const config = {
            portPath,
            baudRate: process.env.SERIAL_BAUDRATE ? parseInt(process.env.SERIAL_BAUDRATE, 10) : 115200,
            lineDelimiter: parsedDelimiter,
            dataType: process.env.SERIAL_DATA_TYPES || 'fermentor-text',
            deviceId: process.env.SERIAL_DEVICE_ID || 'FERMENTOR_KOPI_ESP32S3',
            dbTableName: process.env.SERIAL_DB_TABLE_NAME || 'sensors_data',
            requiredFields: process.env.SERIAL_REQUIRED_FIELDS
                ? process.env.SERIAL_REQUIRED_FIELDS.split(',').map(f => f.trim()).filter(Boolean)
                : [],
            fieldsToEncrypt: process.env.SERIAL_FIELD_TO_ENCRYPT
                ? process.env.SERIAL_FIELD_TO_ENCRYPT.split(',').map(f => f.trim()).filter(Boolean)
                : [],
        };

        console.log('=== SerialManager Config Debug ===');
        console.log('Raw env delimiter:', JSON.stringify(rawDelimiter));
        console.log('Parsed delimiter:', JSON.stringify(parsedDelimiter));
        console.log('Raw env values:');
        console.log('  SERIAL_PORT:', process.env.SERIAL_PORT);
        console.log('  SERIAL_BAUDRATE:', process.env.SERIAL_BAUDRATE);
        console.log('  SERIAL_DATA_TYPES:', process.env.SERIAL_DATA_TYPES);
        console.log('  SERIAL_DB_TABLE_NAME:', process.env.SERIAL_DB_TABLE_NAME);
        console.log('Processed config:', JSON.stringify(config, null, 2));
        console.log('=== End Config Debug ===');

        return config;
    }

    async initialize() {
        try {
            this.serialCommunicator = new SerialCommunicator(
                this.config,
                this.database,
                this.mainWindow
            );

            // Wait for window to load before connecting
            setTimeout(() => {
                console.log('Starting SerialCommunicator connection...');
                this.serialCommunicator.connect();
            }, 2000);

            console.log('Serial manager initialized');
        } catch (error) {
            console.error('Serial manager initialization failed:', error);
            throw error;
        }
    }

    getStatus() {
        return this.serialCommunicator ? this.serialCommunicator.getStatus() : null;
    }

    async forceReconnect() {
        if (this.serialCommunicator) {
            await this.serialCommunicator.forceReconnect();
        }
    }

    async disconnect() {
        if (this.serialCommunicator) {
            await this.serialCommunicator.disconnect();
        }
    }

    async scanForBetterPorts() {
        if (this.serialCommunicator) {
            await this.serialCommunicator.scanForBetterPorts();
        }
    }

    setDynamicPortSwitching(enabled) {
        if (this.serialCommunicator) {
            this.serialCommunicator.setDynamicPortSwitching(enabled);
        }
    }

    sendData(data) {
        if (this.serialCommunicator) {
            this.serialCommunicator.sendData(data);
        }
    }

    writeMixerCommand(line) {
        if (!this.serialCommunicator) return Promise.reject(new Error('Serial not initialized'));
        return this.serialCommunicator.writeMixerCommand(line);
    }

    async close() {
        if (this.serialCommunicator) {
            try {
                await this.serialCommunicator.close();
                console.log('Serial communicator closed');
            } catch (error) {
                console.error('Error closing serial communicator:', error);
                throw error;
            }
        }
    }

    isConnected() {
        return this.serialCommunicator ? this.serialCommunicator.isConnected() : false;
    }
}

module.exports = SerialManager;
