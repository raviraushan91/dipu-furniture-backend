import express from "express";
import { submitContactMessage } from "../../controllers/contactController.js";

const router = express.Router();

router.post("/submit", submitContactMessage);

export default router;
