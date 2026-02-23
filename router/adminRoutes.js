import express from "express";
import {
  getAllUsers,
  deleteUser,
  dashboardStats,
  contactUnreadCount,
  fetchContactMessages,
  markAllContactMessagesRead,
} from "../../controllers/adminController.js";
import {
  authorizedRoles,
  isAuthenticated,
} from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get(
  "/getallusers",
  isAuthenticated,
  authorizedRoles("Admin"),
  getAllUsers
); // DASHBOARD
router.delete(
  "/delete/:id",
  isAuthenticated,
  authorizedRoles("Admin"),
  deleteUser
);
router.get(
  "/fetch/dashboard-stats",
  isAuthenticated,
  authorizedRoles("Admin"),
  dashboardStats
);
router.get(
  "/notifications/contact-unread-count",
  isAuthenticated,
  authorizedRoles("Admin"),
  contactUnreadCount
);
router.get(
  "/notifications/contact-messages",
  isAuthenticated,
  authorizedRoles("Admin"),
  fetchContactMessages
);
router.put(
  "/notifications/contact-mark-read",
  isAuthenticated,
  authorizedRoles("Admin"),
  markAllContactMessagesRead
);

export default router;
