import express from "express";
import {
  fetchSingleOrder,
  placeNewOrder,
  fetchMyOrders,
  fetchAllOrders,
  updateOrderStatus,
  deleteOrder,
  createBestPriceRequest,
  fetchAdminBestPriceRequests,
  confirmBestPriceRequest,
} from "../../controllers/orderController.js";
import {
  createSpecialRequirement,
  fetchAdminSpecialRequirements,
} from "../../controllers/specialRequirementController.js";
import {
  isAuthenticated,
  authorizedRoles,
} from "../../middlewares/authMiddleware.js";

const router = express.Router();
router.post("/new", isAuthenticated, placeNewOrder);
router.post("/special-requirement", createSpecialRequirement);
router.post("/best-price/request", isAuthenticated, createBestPriceRequest);
router.get("/orders/me", isAuthenticated, fetchMyOrders);
router.get(
  "/admin/best-price/requests",
  isAuthenticated,
  authorizedRoles("Admin"),
  fetchAdminBestPriceRequests
);
router.put(
  "/admin/best-price/confirm/:requestId",
  isAuthenticated,
  authorizedRoles("Admin"),
  confirmBestPriceRequest
);
router.get(
  "/admin/special-requirements",
  isAuthenticated,
  authorizedRoles("Admin"),
  fetchAdminSpecialRequirements
);
router.get(
  "/admin/getall",
  isAuthenticated,
  authorizedRoles("Admin"),
  fetchAllOrders
);
router.put(
  "/admin/update/:orderId",
  isAuthenticated,
  authorizedRoles("Admin"),
  updateOrderStatus
);
router.delete(
  "/admin/delete/:orderId",
  isAuthenticated,
  authorizedRoles("Admin"),
  deleteOrder
);
router.get("/:orderId", isAuthenticated, fetchSingleOrder);

export default router;
