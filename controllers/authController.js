import ErrorHandler from "../middlewares/errorMiddleware.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import database from "../database/db.js";
import bcrypt from "bcrypt";
import { sendToken } from "../utils/jwtToken.js";
import { generateResetPasswordToken } from "../utils/generateResetPasswordToken.js";
import { generateEmailTemplate } from "../utils/generateForgotPasswordEmailTemplate.js";
import { sendEmail } from "../utils/sendEmail.js";
import { sendOtpSms, verifyOtpCode } from "../utils/sendOtpSms.js";
import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import jwt from "jsonwebtoken";

const otpRequestTracker = new Map();
const otpVerifyTracker = new Map();

const OTP_RESEND_INTERVAL_MS = 30 * 1000;
const OTP_MAX_REQUESTS_PER_WINDOW = 5;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_VERIFY_BLOCK_MS = 15 * 60 * 1000;

const isProd = process.env.NODE_ENV === "production";
const clearTokenCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
};

const getCookieOptions = () => ({
  expires: new Date(
    Date.now() + Number(process.env.COOKIE_EXPIRES_IN || 30) * 24 * 60 * 60 * 1000
  ),
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
});

const isTwilioConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID
  );

const normalizePhone = (value = "") => {
  const cleaned = String(value).replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
};

const isValidPhone = (value) => /^\+\d{10,15}$/.test(value);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const isValidImageFile = (file) => {
  if (!file) return false;
  const mime = String(file.mimetype || "").toLowerCase();
  return mime.startsWith("image/") && Number(file.size || 0) <= MAX_IMAGE_SIZE_BYTES;
};

export const register = catchAsyncErrors(async (req, res, next) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return next(new ErrorHandler("Please provide all required fields.", 400));
  }
  if (password.length < 8 || password.length > 16) {
    return next(
      new ErrorHandler("Password must be between 8 and 16 characters.", 400)
    );
  }

  const isAlreadyRegistered = await database.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );

  if (isAlreadyRegistered.rows.length > 0) {
    return next(
      new ErrorHandler("User already registered with this email.", 400)
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await database.query(
    "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
    [name, email, hashedPassword]
  );
  sendToken(user.rows[0], 201, "User registered successfully", res);
});

export const login = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new ErrorHandler("Please provide email and password.", 400));
  }
  const user = await database.query(`SELECT * FROM users WHERE email = $1`, [
    email,
  ]);
  if (user.rows.length === 0) {
    return next(new ErrorHandler("Invalid email or password.", 401));
  }
  const isPasswordMatch = await bcrypt.compare(password, user.rows[0].password);
  if (!isPasswordMatch) {
    return next(new ErrorHandler("Invalid email or password.", 401));
  }
  sendToken(user.rows[0], 200, "Logged In.", res);
});

export const getUser = catchAsyncErrors(async (req, res, next) => {
  const { user } = req;
  res.status(200).json({
    success: true,
    user,
  });
});

export const logout = catchAsyncErrors(async (req, res, next) => {
  res
    .status(200)
    .cookie("token", "", { ...clearTokenCookieOptions, expires: new Date(Date.now()) })
    .json({
      success: true,
      message: "Logged out successfully.",
    });
});

export const forgotPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;
  const { frontendUrl } = req.query;
  let userResult = await database.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );
  if (userResult.rows.length === 0) {
    return next(new ErrorHandler("User not found with this email.", 404));
  }
  const user = userResult.rows[0];
  const { hashedToken, resetPasswordExpireTime, resetToken } =
    generateResetPasswordToken();

  await database.query(
    `UPDATE users SET reset_password_token = $1, reset_password_expire = to_timestamp($2) WHERE email = $3`,
    [hashedToken, resetPasswordExpireTime / 1000, email]
  );

  const resetPasswordUrl = `${frontendUrl}/password/reset/${resetToken}`;

  const message = generateEmailTemplate(resetPasswordUrl);

  try {
    await sendEmail({
      email: user.email,
      subject: "Ecommerce Password Recovery",
      message,
    });
    res.status(200).json({
      success: true,
      message: `Email sent to ${user.email} successfully.`,
    });
  } catch (error) {
    await database.query(
      `UPDATE users SET reset_password_token = NULL, reset_password_expire = NULL WHERE email = $1`,
      [email]
    );
    return next(new ErrorHandler("Email could not be sent.", 500));
  }
});

export const resetPassword = catchAsyncErrors(async (req, res, next) => {
  const { token } = req.params;
  const resetPasswordToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
  const user = await database.query(
    "SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expire > NOW()",
    [resetPasswordToken]
  );
  if (user.rows.length === 0) {
    return next(new ErrorHandler("Invalid or expired reset token.", 400));
  }
  if (req.body.password !== req.body.confirmPassword) {
    return next(new ErrorHandler("Passwords do not match.", 400));
  }
  if (
    req.body.password?.length < 8 ||
    req.body.password?.length > 16 ||
    req.body.confirmPassword?.length < 8 ||
    req.body.confirmPassword?.length > 16
  ) {
    return next(
      new ErrorHandler("Password must be between 8 and 16 characters.", 400)
    );
  }
  const hashedPassword = await bcrypt.hash(req.body.password, 10);

  const updatedUser = await database.query(
    `UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expire = NULL WHERE id = $2 RETURNING *`,
    [hashedPassword, user.rows[0].id]
  );
  sendToken(updatedUser.rows[0], 200, "Password reset successfully", res);
});

export const updatePassword = catchAsyncErrors(async (req, res, next) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;
  console.log(currentPassword, newPassword, confirmNewPassword)
  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return next(new ErrorHandler("Please provide all required fields.", 400));
  }
  const isPasswordMatch = await bcrypt.compare(
    currentPassword,
    req.user.password
  );
  if (!isPasswordMatch) {
    return next(new ErrorHandler("Current password is incorrect.", 401));
  }
  if (newPassword !== confirmNewPassword) {
    return next(new ErrorHandler("New passwords do not match.", 400));
  }

  if (
    newPassword.length < 8 ||
    newPassword.length > 16 ||
    confirmNewPassword.length < 8 ||
    confirmNewPassword.length > 16
  ) {
    return next(
      new ErrorHandler("Password must be between 8 and 16 characters.", 400)
    );
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await database.query("UPDATE users SET password = $1 WHERE id = $2", [
    hashedPassword,
    req.user.id,
  ]);

  res.status(200).json({
    success: true,
    message: "Password updated successfully.",
  });
});

export const updateProfile = catchAsyncErrors(async (req, res, next) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return next(new ErrorHandler("Please provide all required fields.", 400));
  }
  if (name.trim().length === 0 || email.trim().length === 0) {
    return next(new ErrorHandler("Name and email cannot be empty.", 400));
  }
  let avatarData = {};
  if (req.files && req.files.avatar) {
    const { avatar } = req.files;
    if (!isValidImageFile(avatar)) {
      return next(new ErrorHandler("Only image files up to 5MB are allowed.", 400));
    }
    if (req.user?.avatar?.public_id) {
      await cloudinary.uploader.destroy(req.user.avatar.public_id);
    }

    const newProfileImage = await cloudinary.uploader.upload(
      avatar.tempFilePath,
      {
        folder: "Ecommerce_Avatars",
        width: 150,
        crop: "scale",
      }
    );
    avatarData = {
      public_id: newProfileImage.public_id,
      url: newProfileImage.secure_url,
    };
  }
  let user;
  if (Object.keys(avatarData).length === 0) {
    user = await database.query(
      "UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *",
      [name, email, req.user.id]
    );
  } else {
    user = await database.query(
      "UPDATE users SET name = $1, email = $2, avatar = $3 WHERE id = $4 RETURNING *",
      [name, email, avatarData, req.user.id]
    );
  }

  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
    user: user.rows[0],
  });
});

export const sendMobileOtp = catchAsyncErrors(async (req, res, next) => {
  const phone = normalizePhone(req.body.phone);

  if (!isValidPhone(phone)) {
    return next(new ErrorHandler("Please enter a valid mobile number.", 400));
  }

  const now = Date.now();
  const tracker = otpRequestTracker.get(phone) || {
    count: 0,
    windowStart: now,
    lastSentAt: 0,
  };

  if (now - tracker.windowStart > OTP_REQUEST_WINDOW_MS) {
    tracker.count = 0;
    tracker.windowStart = now;
  }

  if (now - tracker.lastSentAt < OTP_RESEND_INTERVAL_MS) {
    return next(new ErrorHandler("Please wait before requesting OTP again.", 429));
  }

  if (tracker.count >= OTP_MAX_REQUESTS_PER_WINDOW) {
    return next(new ErrorHandler("Too many OTP requests. Try again later.", 429));
  }

  if (!isTwilioConfigured()) {
    return next(
      new ErrorHandler(
        "Twilio Verify is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.",
        503
      )
    );
  }

  tracker.count += 1;
  tracker.lastSentAt = now;
  otpRequestTracker.set(phone, tracker);
  otpVerifyTracker.delete(phone);

  try {
    await sendOtpSms(phone);
  } catch (error) {
    otpRequestTracker.set(phone, {
      ...tracker,
      count: Math.max(0, tracker.count - 1),
    });
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Failed to send OTP SMS. Please try again in a moment."
        : error?.message || "Failed to send OTP SMS.";
    return next(new ErrorHandler(safeMessage, 500));
  }

  res.status(200).json({
    success: true,
    message: `OTP sent to ${phone}.`,
  });
});

export const verifyMobileOtp = catchAsyncErrors(async (req, res, next) => {
  const phone = normalizePhone(req.body.phone);
  const { otp, name } = req.body;
  const phoneDigits = phone.replace(/\D/g, "");

  if (!isValidPhone(phone)) {
    return next(new ErrorHandler("Please enter a valid mobile number.", 400));
  }

  if (!otp || String(otp).length !== 6) {
    return next(new ErrorHandler("Please enter a valid 6-digit OTP.", 400));
  }

  const now = Date.now();
  const verifyState = otpVerifyTracker.get(phone) || {
    attempts: 0,
    blockedUntil: 0,
  };

  if (verifyState.blockedUntil && now < verifyState.blockedUntil) {
    return next(new ErrorHandler("Too many invalid OTP attempts. Try again later.", 429));
  }

  if (!isTwilioConfigured()) {
    return next(
      new ErrorHandler(
        "Twilio Verify is not configured. OTP login is unavailable.",
        503
      )
    );
  }

  let isApproved = false;
  try {
    isApproved = await verifyOtpCode(phone, otp);
  } catch (error) {
    return next(
      new ErrorHandler(
        process.env.NODE_ENV === "production"
          ? "OTP verification failed. Please try again."
          : error?.message || "OTP verification failed.",
        500
      )
    );
  }

  if (!isApproved) {
    verifyState.attempts += 1;
    if (verifyState.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      verifyState.blockedUntil = now + OTP_VERIFY_BLOCK_MS;
      verifyState.attempts = 0;
    }
    otpVerifyTracker.set(phone, verifyState);
    return next(new ErrorHandler("Invalid OTP.", 400));
  }
  otpVerifyTracker.delete(phone);

  const syntheticEmail = `m_${phoneDigits}@mobile.apnafurniture.local`;
  const legacySyntheticEmail = `m_${phoneDigits}@mobile.dipufurniture.local`;
  let userResult = await database.query(
    `SELECT * FROM users
     WHERE phone = $1
       OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [phone, phoneDigits]
  );

  if (userResult.rows.length === 0) {
    userResult = await database.query(
      `SELECT * FROM users WHERE email = ANY($1::text[]) ORDER BY created_at ASC LIMIT 1`,
      [[syntheticEmail, legacySyntheticEmail]]
    );
  }

  if (userResult.rows.length > 0 && userResult.rows[0].role !== "User") {
    return next(
      new ErrorHandler(
        "This mobile number is linked to a restricted account type.",
        403
      )
    );
  }

  if (userResult.rows.length === 0) {
    const randomPassword = await bcrypt.hash(crypto.randomUUID(), 10);
    const displayName =
      name && String(name).trim().length >= 3
        ? String(name).trim()
        : `User ${phone.slice(-4)}`;

    userResult = await database.query(
      "INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, 'User') RETURNING *",
      [displayName, syntheticEmail, phone, randomPassword]
    );
  } else if (!userResult.rows[0].phone) {
    // Backward compatibility: migrate old synthetic-email mobile users.
    userResult = await database.query(
      "UPDATE users SET phone = $1 WHERE id = $2 RETURNING *",
      [phone, userResult.rows[0].id]
    );
  }

  sendToken(userResult.rows[0], 200, "Logged in with mobile OTP.", res);
});

export const deleteAccount = catchAsyncErrors(async (req, res, next) => {
  const deletedUser = await database.query(
    "DELETE FROM users WHERE id = $1 RETURNING id",
    [req.user.id]
  );

  if (deletedUser.rows.length === 0) {
    return next(new ErrorHandler("User not found.", 404));
  }

  res
    .status(200)
    .cookie("token", "", { ...clearTokenCookieOptions, expires: new Date(Date.now()) })
    .json({
      success: true,
      message: "Account deleted successfully.",
    });
});

export const socialLoginSuccess = catchAsyncErrors(async (req, res, next) => {
  if (!req.user) {
    return next(new ErrorHandler("Social login failed.", 401));
  }

  const token = jwt.sign({ id: req.user.id }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  res.cookie("token", token, getCookieOptions());

  res.redirect(`${process.env.FRONTEND_URL}/?auth=success`);
});

export const socialLoginFailed = (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL}/?auth=failed`);
};
