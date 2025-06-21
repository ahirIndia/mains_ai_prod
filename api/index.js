// UPDATED AND VERSEL-READY: api/index.js

// 1. Import necessary tools
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// 2. Setup the application
const app = express();

// --- Middleware Configuration ---
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Parse JSON request bodies

// --- Vercel-Compatible File Upload Setup ---
// Vercel has a READ-ONLY filesystem, except for the '/tmp' directory.
// We save files to '/tmp/uploads' temporarily.
// WARNING: This is not permanent storage. Files will be deleted.
const uploadDir = path.join('/tmp', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Setup Multer to use the temporary '/tmp/uploads' directory
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- MongoDB Connection Management for Serverless ---
// We cache the database connection to reuse it across function invocations.
let cachedDb = null;
async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }
    try {
        const mongoURI = process.env.MONGO_URI;
        if (!mongoURI) {
            throw new Error("MONGO_URI environment variable is not set.");
        }
        console.log("Connecting to MongoDB...");
        const db = await mongoose.connect(mongoURI);
        cachedDb = db;
        console.log("Successfully connected to MongoDB Atlas!");
        return db;
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw error;
    }
}

// --- Mongoose Schema and Model Definition ---
const answerSchema = new mongoose.Schema({
    title: String,
    fileName: String,
    filePath: String, // Note: This path will be to the temporary /tmp directory
    question: String,
    uploadDate: String,
    gsPaper: String,
    source: String,
    mimeType: String,
});
// This prevents Mongoose from recompiling the model in a serverless environment
const Answer = mongoose.models.Answer || mongoose.model("Answer", answerSchema);

// --- API Routes ---

// This middleware runs before every API request to ensure the DB is connected
app.use(async (req, res, next) => {
    try {
        await connectToDatabase();
        next();
    } catch (error) {
        res.status(500).json({ message: "Database connection failed", error: error.message });
    }
});

// Route to get all answers
app.get("/api/answers", async (req, res) => {
    try {
        const answers = await Answer.find().sort({ uploadDate: -1 });
        res.json(answers);
    } catch (error) {
        res.status(500).json({ message: "Error fetching answers", error: error.message });
    }
});

// Route to handle new answer uploads
app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
        const newAnswer = new Answer({
            title: req.body.title,
            fileName: req.file ? req.file.filename : null,
            filePath: req.file ? req.file.path : null, // The path is to '/tmp/uploads/...'
            question: req.body.question,
            uploadDate: req.body.uploadDate,
            gsPaper: req.body.gsPaper,
            source: req.body.source,
            mimeType: req.file ? req.file.mimetype : null
        });
        await newAnswer.save();
        res.status(201).json(newAnswer);
    } catch (error) {
        res.status(500).json({ message: "Error uploading answer", error: error.message });
    }
});

// Route to delete an answer
app.delete("/api/answers/:id", async (req, res) => {
    try {
        const answer = await Answer.findById(req.params.id);
        if (!answer) {
            return res.status(404).send("Answer not found");
        }
        // Clean up the temporary file if it exists
        if (answer.filePath && fs.existsSync(answer.filePath)) {
            fs.unlink(answer.filePath, (err) => {
                if (err) console.error("Error deleting temp file:", err);
            });
        }
        await Answer.findByIdAndDelete(req.params.id);
        res.send({ message: "Answer deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting answer", error: error.message });
    }
});

// Route for serving the temporary files
// This allows the frontend to display uploaded images/PDFs
app.get('/api/uploads/:fileName', (req, res) => {
    const { fileName } = req.params;
    const filePath = path.join(uploadDir, fileName);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('File not found. It may have been cleared from temporary storage.');
    }
});

// --- Vercel Serverless Function Export ---
// This exports the Express app for Vercel to use.
// We DO NOT use app.listen() here.
module.exports = app;