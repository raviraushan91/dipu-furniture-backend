import database from "../database/db.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/errorMiddleware.js";

export const submitContactMessage = catchAsyncErrors(async (req, res, next) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return next(new ErrorHandler("Please provide all contact details.", 400));
  }

  const result = await database.query(
    `INSERT INTO contact_messages (name, email, subject, message)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [String(name).trim(), String(email).trim(), String(subject).trim(), String(message).trim()]
  );

  res.status(201).json({
    success: true,
    message: "Message sent successfully.",
    contact: result.rows[0],
  });
});
