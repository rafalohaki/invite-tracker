/**
 * @file database/connection.js
 * @description Establishes and manages the connection to the MongoDB database using Mongoose.
 * Includes connection event handling and graceful shutdown logic.
 */

const mongoose = require('mongoose');
// dotenv is required here to ensure MONGODB_URI is loaded before attempting connection.
require('dotenv').config();

// Retrieve the MongoDB connection string from environment variables.
const MONGODB_URI = process.env.MONGODB_URI;

// Critical check: Ensure the MongoDB URI is provided. Terminate if missing.
if (!MONGODB_URI) {
    console.error("FATAL ERROR: MONGODB_URI is not defined in the .env file. Please set it and restart.");
    process.exit(1); // Exit the process with an error code
}

/**
 * @description Asynchronous function to connect to the MongoDB database.
 * Sets recommended Mongoose options and handles initial connection errors.
 */
const connectDB = async () => {
    try {
        // Attempt to connect to MongoDB using the URI and recommended options.
        // Modern Mongoose versions handle useNewUrlParser and useUnifiedTopology automatically.
        await mongoose.connect(MONGODB_URI, {
            // Example option: Set a shorter server selection timeout (default is 30000ms).
            serverSelectionTimeoutMS: 5000
        });
        console.log('MongoDB Connected Successfully.');
    } catch (err) {
        console.error('MongoDB Connection Failed:', err.message);
        // Provide helpful hints for common connection issues.
        console.error('Common causes: Incorrect MONGODB_URI in .env, MongoDB server not running, firewall blocking connection, IP whitelist issues on Atlas/cloud provider.');
        process.exit(1); // Exit the process on critical connection failure
    }
};

// --- Mongoose Connection Event Listeners ---

// Listen for runtime errors after the initial connection has been established.
mongoose.connection.on('error', err => {
    console.error('MongoDB Runtime Error:', err.message);
    // Consider adding more robust error handling/reporting here if needed.
});

// Listen for when the connection is lost.
mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected.'); // Use 'warn' level as it might be temporary
});

// Listen for when Mongoose successfully reconnects.
mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected.');
});

// --- Graceful Shutdown Handling ---

/**
 * @description Closes the MongoDB connection gracefully when the Node.js process receives a termination signal.
 * @param {string} signal - The signal received (e.g., 'SIGINT', 'SIGTERM').
 */
async function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Closing MongoDB connection...`);
    try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed successfully.');
    } catch (err) {
        console.error('Error closing MongoDB connection during shutdown:', err);
    } finally {
        console.log('Exiting process.');
        process.exit(0); // Exit cleanly
    }
}

// Listen for common termination signals (Ctrl+C, kill command)
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));


module.exports = connectDB; // Export the connection function