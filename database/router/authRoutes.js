import express from "express";
import passport from "passport";
import {
  deleteAccount,
  forgotPassword,
  getUser,
  login,
  logout,
  register,
  resetPassword,
  sendMobileOtp,
  socialLoginFailed,
  socialLoginSuccess,
  updatePassword,
  updateProfile,
  verifyMobileOtp,
} from "../../controllers/authController.js";
import { isAuthenticated } from "../../middlewares/authMiddleware.js";
import ErrorHandler from "../../middlewares/errorMiddleware.js";
import { catchAsyncErrors } from "../../middlewares/catchAsyncError.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/mobile/send-otp", sendMobileOtp);
router.post("/mobile/verify-otp", verifyMobileOtp);
router.get("/me", isAuthenticated, getUser);
router.get("/logout", isAuthenticated, logout);
router.post("/password/forgot", forgotPassword);
router.put("/password/reset/:token", resetPassword);
router.put("/password/update", isAuthenticated, updatePassword);
router.put("/profile/update", isAuthenticated, updateProfile);
router.delete("/account/delete", isAuthenticated, deleteAccount);

const ensureGoogleOAuthConfigured = catchAsyncErrors(async (_req, _res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return next(
      new ErrorHandler(
        "Google OAuth is not configured on server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        503
      )
    );
  }
  next();
});

const ensureFacebookOAuthConfigured = catchAsyncErrors(
  async (_req, _res, next) => {
    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      return next(
        new ErrorHandler(
          "Facebook OAuth is not configured on server. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.",
          503
        )
      );
    }
    next();
  }
);

router.get(
  "/google",
  ensureGoogleOAuthConfigured,
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);
router.get(
  "/google/callback",
  ensureGoogleOAuthConfigured,
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/api/v1/auth/social/failed",
  }),
  socialLoginSuccess
);

router.get(
  "/facebook",
  ensureFacebookOAuthConfigured,
  passport.authenticate("facebook", {
    scope: ["email"],
    session: false,
  })
);
router.get(
  "/facebook/callback",
  ensureFacebookOAuthConfigured,
  passport.authenticate("facebook", {
    session: false,
    failureRedirect: "/api/v1/auth/social/failed",
  }),
  socialLoginSuccess
);

router.get("/social/failed", socialLoginFailed);

export default router;
